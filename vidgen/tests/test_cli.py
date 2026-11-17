from typer.testing import CliRunner

import vidgen
from vidgen.cli import app

runner = CliRunner()


def test_version():
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.output.strip() == f"vidgen {vidgen.__version__}"
