"""The ``vidgen`` command line."""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Optional

import typer

from vidgen import __version__
from vidgen.schema import ScriptError, load_script

app = typer.Typer(no_args_is_help=True, add_completion=False, help="Narrated technical explainer videos.")


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
