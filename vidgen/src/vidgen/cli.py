"""The ``vidgen`` command line.

Exit codes: 0 ok; 1 validation or lint failure; 2 an endpoint, alignment, tool or renderer
failure (one-line message).
"""

from __future__ import annotations

import functools
from collections.abc import Callable
from pathlib import Path
from typing import Annotated, Any, Optional, TypeVar

import typer

from vidgen import __version__
from vidgen.align import AlignError
from vidgen.config import Config, ConfigError, load_config
from vidgen.schema import ScriptError, load_script
from vidgen.tools import ToolFailed, ToolMissing
from vidgen.tts.engine import EndpointError

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Narrated technical explainer videos.")

F = TypeVar("F", bound=Callable[..., Any])

ScriptArg = Annotated[Path, typer.Argument(help="The script.yaml.")]
ConfigOpt = Annotated[Optional[Path], typer.Option("--config", help="Use this vidgen.toml instead of searching.")]
OutOpt = Annotated[Optional[Path], typer.Option("--out", help="Build dir (default: <cache>/builds/<slug>).")]
DraftOpt = Annotated[bool, typer.Option("--draft", help="Render at 1280x720.")]


def _version(value: bool) -> None:
    if value:
        typer.echo(f"vidgen {__version__}")
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        Optional[bool],
        typer.Option("--version", callback=_version, is_eager=True, help="Print the version and exit."),
    ] = None,
) -> None:
    """Narrated technical explainer videos."""


def _one_line(e: Exception) -> str:
    lines = [line for line in str(e).splitlines() if line.strip()]
    head = lines[0] if lines else type(e).__name__
    tail = getattr(e, "stderr_tail", "")
    if tail:
        last = [line for line in tail.splitlines() if line.strip()]
        if last and last[-1] not in head:
            head = f"{head.rstrip(':')}: {last[-1].strip()}"
    return head


def _guarded(fn: F) -> F:
    """Map pipeline errors to exit codes and messages."""
    from vidgen.build import BuildUsageError, LintFailed
    from vidgen.render import RendererError

    @functools.wraps(fn)
    def wrapper(*args: Any, **kwargs: Any) -> Any:
        try:
            return fn(*args, **kwargs)
        except ScriptError as e:
            for issue in e.issues:
                typer.echo(str(issue))
            raise typer.Exit(1)
        except LintFailed as e:
            typer.echo(str(e))
            raise typer.Exit(1)
        except (ConfigError, BuildUsageError) as e:
            typer.echo(f"error: {e}")
            raise typer.Exit(1)
        except (EndpointError, AlignError, ToolMissing, ToolFailed, RendererError) as e:
            typer.echo(f"error: {_one_line(e)}")
            raise typer.Exit(2)

    return wrapper  # type: ignore[return-value]


def _config(script: Path, explicit: Path | None, draft: bool = False) -> Config:
    cfg = load_config(script, explicit)
    if draft:
        cfg = cfg.model_copy(update={"draft": True})
    return cfg


@app.command()
def validate(
    script: Annotated[Path, typer.Argument(help="The script.yaml to check.")],
) -> None:
    """Check a script's schema, references and cues (no endpoints needed)."""
    try:
        s = load_script(script)
    except ScriptError as e:
        for issue in e.issues:
            typer.echo(str(issue))
        raise typer.Exit(1)
    typer.echo(f"ok: {len(s.scenes)} scenes")


@app.command()
@_guarded
def build(
    script: ScriptArg,
    out: OutOpt = None,
    burn_captions: Annotated[bool, typer.Option("--burn-captions", help="Also write video.burned.mp4.")] = False,
    draft: DraftOpt = False,
    config: ConfigOpt = None,
) -> None:
    """Build the video: TTS, alignment, lint, render, assemble."""
    from vidgen.build import build as run_build

    r = run_build(script, _config(script, config, draft), out=out, burn=burn_captions)
    typer.echo(f"rendered {len(r.rendered)} scene(s), reused {len(r.reused)}; {r.duration:.2f} s")
    typer.echo(str(r.video))


@app.command()
@_guarded
def tts(script: ScriptArg, config: ConfigOpt = None) -> None:
    """Synthesize and align every scene's narration (cached)."""
    from vidgen.build import synthesize_all

    s = load_script(script)
    for sid, audio in synthesize_all(s, _config(script, config)).items():
        typer.echo(f"{sid}: {audio.duration:.2f} s, {len(audio.words)} words, {audio.path}")


@app.command()
@_guarded
def render(
    script: ScriptArg,
    scene: Annotated[str, typer.Option("--scene", help="Scene id or 1-based number.")],
    out: OutOpt = None,
    draft: DraftOpt = False,
    config: ConfigOpt = None,
) -> None:
    """Render one scene to scenes/NN-<id>.mp4."""
    from vidgen.build import render_one

    typer.echo(str(render_one(script, _config(script, config, draft), scene, out)))


@app.command()
@_guarded
def preview(
    script: ScriptArg,
    t: Annotated[Optional[list[float]], typer.Option("--t", help="Whole-video time in seconds (repeatable).")] = None,
    out: OutOpt = None,
    draft: DraftOpt = False,
    config: ConfigOpt = None,
) -> None:
    """Write PNG frames at whole-video times (default: the 3 densest moments)."""
    from vidgen.build import preview as run_preview

    for p in run_preview(script, _config(script, config, draft), list(t or []), out):
        typer.echo(str(p))


@app.command()
def doctor(
    script: Annotated[Optional[Path], typer.Argument(help="Find vidgen.toml as for this script.")] = None,
    config: ConfigOpt = None,
) -> None:
    """Check Python, Node, the renderer, ffmpeg and its encoders, and every configured endpoint."""
    from vidgen.doctor import doctor as run_doctor

    try:
        cfg = load_config(script, config)
    except ConfigError as e:
        typer.echo(f"fail config: {e}")
        raise typer.Exit(1)
    checks = run_doctor(cfg)
    for c in checks:
        typer.echo(str(c))
    if any(c.status == "fail" for c in checks):
        raise typer.Exit(1)


@app.command()
@_guarded
def lint(script: ScriptArg, config: ConfigOpt = None) -> None:
    """Lint every scene for overlaps and overflow (needs TTS for timing)."""
    from vidgen.build import _prepare, lint_all

    cfg = _config(script, config)
    p = _prepare(script, cfg)
    lint_all(cfg, p.scenes)
    typer.echo(f"ok: {len(p.scenes)} scenes, no lint issues")
