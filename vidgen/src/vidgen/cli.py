"""The ``vidgen`` command line."""

from __future__ import annotations

from typing import Annotated, Optional

import typer

from vidgen import __version__

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
