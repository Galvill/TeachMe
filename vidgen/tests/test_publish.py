"""Publishing. S3 goes through moto (or a stub client); nothing here touches the network."""

import hashlib
import json
import shutil
from pathlib import Path

import boto3
import pytest
from botocore.exceptions import NoCredentialsError
from moto import mock_aws
from typer.testing import CliRunner

from vidgen import publish as publish_mod
from vidgen.cli import app
from vidgen.config import Config, LocalTarget, Paths, Publish, S3Target
from vidgen.contracts import dumps
from vidgen.manifest import manifest_path, read_manifest
from vidgen.publish import PublishError, publish
from vidgen.schema import load_script, script_hash

FIXTURES = Path(__file__).parent / "fixtures"
runner = CliRunner()
BUILD_FILES = {"video.mp4": b"\x00\x00\x00 ftypisom fake video", "captions.srt": b"1\n00:00:00,000 --> 00:00:01,000\nHi\n",
               "poster.png": b"\x89PNG\r\n\x1a\n fake poster"}


@pytest.fixture(autouse=True)
def aws_env(monkeypatch, tmp_path):
    """Dummy credentials and no config files, so boto3 never sees the developer's real profile."""
    monkeypatch.setenv("AWS_ACCESS_KEY_ID", "testing")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "testing")
    monkeypatch.setenv("AWS_SESSION_TOKEN", "testing")
    monkeypatch.setenv("AWS_DEFAULT_REGION", "us-east-1")
    monkeypatch.setenv("AWS_CONFIG_FILE", str(tmp_path / "no-aws-config"))
    monkeypatch.setenv("AWS_SHARED_CREDENTIALS_FILE", str(tmp_path / "no-aws-credentials"))
    monkeypatch.setenv("AWS_EC2_METADATA_DISABLED", "true")
    monkeypatch.delenv("AWS_PROFILE", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL", raising=False)
    monkeypatch.delenv("AWS_ENDPOINT_URL_S3", raising=False)


@pytest.fixture
def script(tmp_path) -> Path:
    d = tmp_path / "videos" / "dns-mini"
    d.mkdir(parents=True)
    path = d / "script.yaml"
    shutil.copyfile(FIXTURES / "dns-mini.yaml", path)
    return path


def make_build(script_path: Path, cache: Path, **over) -> Path:
    """A finished build dir as ``vidgen build`` leaves it (fake media, real build.json)."""
    s = load_script(script_path)
    d = cache / "builds" / s.slug
    d.mkdir(parents=True, exist_ok=True)
    for name, data in BUILD_FILES.items():
        (d / name).write_bytes(data)
    meta = {
        "version": 1, "slug": s.slug, "title": s.title, "scriptHash": script_hash(s),
        "syncedCommit": s.syncedCommit, "sources": list(s.sources), "draft": False, "durationSec": 12.5,
        "width": 1920, "height": 1080, "language": s.language,
        "tts": {"endpoint": "fake", "model": "fake-model", "voice": "default", "license": "MIT"},
        "vidgenVersion": "0.0.0",
        "files": {"video": "video.mp4", "captions": "captions.srt", "poster": "poster.png", "timeline": "timeline.json"},
    }
    meta.update(over)
    (d / "build.json").write_text(dumps(meta), encoding="utf-8")
    return d


def video_sha() -> str:
    return hashlib.sha256(BUILD_FILES["video.mp4"]).hexdigest()


def cfg_with(tmp_path, targets, default=None) -> Config:
    return Config(paths=Paths(cache=tmp_path / "cache"), publish=Publish(default=default, targets=targets))


# --- local --------------------------------------------------------------------------------


def test_local_publish_layout(tmp_path, script):
    make_build(script, tmp_path / "cache")
    pub = tmp_path / "pub"
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=pub)}, default="nas")
    m = publish(script, cfg)

    objdir = pub / "dns-mini" / video_sha()[:12]
    assert sorted(p.name for p in objdir.iterdir()) == ["captions.srt", "poster.png", "video.mp4"]
    assert sorted(p.relative_to(pub).as_posix() for p in pub.rglob("*") if p.is_file()) == [
        f"dns-mini/{video_sha()[:12]}/{n}" for n in ("captions.srt", "poster.png", "video.mp4")
    ]
    for role, name in (("video", "video.mp4"), ("captions", "captions.srt"), ("poster", "poster.png")):
        ref = getattr(m.files, role)
        assert ref.location == (objdir / name).resolve().as_uri()
        assert ref.location.startswith("file:///")
        assert ref.url is None
        assert ref.sha256 == hashlib.sha256(BUILD_FILES[name]).hexdigest()
        assert ref.bytes == len(BUILD_FILES[name])
    assert m.target == "nas"
    assert m.slug == "dns-mini"
    assert m.resolution == (1920, 1080)
    assert m.tts.engine == "fake" and m.tts.license == "MIT"
    assert m.scriptHash == script_hash(load_script(script))


def test_local_public_url(tmp_path, script):
    make_build(script, tmp_path / "cache")
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub", public_base_url="http://nas.local/vidgen/")})
    m = publish(script, cfg, target="nas")
    h = video_sha()[:12]
    assert m.files.video.url == f"http://nas.local/vidgen/dns-mini/{h}/video.mp4"
    assert m.files.captions.url == f"http://nas.local/vidgen/dns-mini/{h}/captions.srt"
    assert m.files.poster.url == f"http://nas.local/vidgen/dns-mini/{h}/poster.png"


def test_local_never_writes_outside_path(tmp_path, script):
    make_build(script, tmp_path / "cache")
    pub = tmp_path / "pub"
    outside = tmp_path / "outside"
    outside.mkdir()
    pub.mkdir()
    (pub / "dns-mini").symlink_to(outside, target_is_directory=True)
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=pub)}, default="nas")
    with pytest.raises(PublishError, match="escapes the publish path"):
        publish(script, cfg)
    assert list(outside.iterdir()) == []


def test_local_planted_temp_symlink_not_followed(tmp_path, script):
    make_build(script, tmp_path / "cache")
    pub = tmp_path / "pub"
    objdir = pub / "dns-mini" / video_sha()[:12]
    objdir.mkdir(parents=True)
    victim = tmp_path / "victim.txt"
    victim.write_bytes(b"untouched")
    # Symlinks at the old predictable temp names, and at a final name, all pointing outside.
    for name in BUILD_FILES:
        (objdir / f".{name}.tmp").symlink_to(victim)
    (objdir / "poster.png").symlink_to(victim)
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=pub)}, default="nas")
    publish(script, cfg)
    assert victim.read_bytes() == b"untouched"
    for name, data in BUILD_FILES.items():
        assert not (objdir / name).is_symlink()
        assert (objdir / name).read_bytes() == data


def test_build_file_outside_build_dir_refused(tmp_path, script):
    make_build(script, tmp_path / "cache", files={"video": "../../x.mp4", "captions": "captions.srt",
                                                   "poster": "poster.png"})
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub")}, default="nas")
    with pytest.raises(PublishError, match="outside the build dir"):
        publish(script, cfg)


# --- S3 -----------------------------------------------------------------------------------


def s3_cfg(tmp_path, **target) -> Config:
    t = S3Target(bucket="my-videos", prefix="teachme", region="us-east-1", **target)
    return cfg_with(tmp_path, {"s3": t}, default="s3")


def test_s3_upload_metadata(tmp_path, script):
    make_build(script, tmp_path / "cache")
    with mock_aws():
        s3 = boto3.client("s3", region_name="us-east-1")
        s3.create_bucket(Bucket="my-videos")
        m = publish(script, s3_cfg(tmp_path, public_base_url="https://cdn.example.com/teachme"))
        h = video_sha()[:12]
        types = {"video.mp4": "video/mp4", "captions.srt": "application/x-subrip", "poster.png": "image/png"}
        for name, ctype in types.items():
            key = f"teachme/dns-mini/{h}/{name}"
            head = s3.head_object(Bucket="my-videos", Key=key)
            assert head["ContentType"] == ctype
            assert head["Metadata"]["sha256"] == hashlib.sha256(BUILD_FILES[name]).hexdigest()
            body = s3.get_object(Bucket="my-videos", Key=key)["Body"].read()
            assert body == BUILD_FILES[name]
        assert m.files.video.location == f"s3://my-videos/teachme/dns-mini/{h}/video.mp4"
        # public_base_url is the public root of the prefix (spec §10's example).
        assert m.files.video.url == f"https://cdn.example.com/teachme/dns-mini/{h}/video.mp4"
        assert m.target == "s3"


def test_s3_skip_existing(tmp_path, script, monkeypatch):
    make_build(script, tmp_path / "cache")
    with mock_aws():
        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="my-videos")
        cfg = s3_cfg(tmp_path)
        publish(script, cfg)

        uploads: list[str] = []
        real_client = publish_mod._s3_client

        def counting(t):
            c = real_client(t)
            orig = c.upload_file

            def upload_file(filename, bucket, key, **kw):
                uploads.append(key)
                return orig(filename, bucket, key, **kw)

            c.upload_file = upload_file
            return c

        monkeypatch.setattr(publish_mod, "_s3_client", counting)
        m = publish(script, cfg)
        assert uploads == []
        assert m.files.video.url is None

        # A key whose sha256 metadata doesn't match is uploaded again.
        s3 = boto3.client("s3", region_name="us-east-1")
        key = f"teachme/dns-mini/{video_sha()[:12]}/poster.png"
        s3.put_object(Bucket="my-videos", Key=key, Body=b"other", Metadata={"sha256": "0" * 64})
        publish(script, cfg)
        assert uploads == [key]


def test_s3_endpoint_url_passed(tmp_path, script, monkeypatch):
    make_build(script, tmp_path / "cache")
    calls: list[tuple[tuple, dict]] = []
    real = boto3.client

    def spy(*args, **kwargs):
        calls.append((args, kwargs))
        kwargs = {**kwargs, "endpoint_url": None}  # moto serves the default AWS endpoints
        return real(*args, **kwargs)

    with mock_aws():
        real("s3", region_name="eu-west-1").create_bucket(
            Bucket="my-videos", CreateBucketConfiguration={"LocationConstraint": "eu-west-1"}
        )
        monkeypatch.setattr(boto3, "client", spy)
        t = S3Target(bucket="my-videos", region="eu-west-1", endpoint_url="https://minio.example.com")
        m = publish(script, cfg_with(tmp_path, {"minio": t}), target="minio")
    assert calls == [(("s3",), {"region_name": "eu-west-1", "endpoint_url": "https://minio.example.com"})]
    assert m.files.video.location == f"s3://my-videos/dns-mini/{video_sha()[:12]}/video.mp4"


# --- refusals -----------------------------------------------------------------------------


def test_refuse_no_build(tmp_path, script):
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub")}, default="nas")
    with pytest.raises(PublishError, match="^no build for dns-mini; run vidgen build$"):
        publish(script, cfg)


def test_refuse_draft(tmp_path, script):
    make_build(script, tmp_path / "cache", draft=True)
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub")}, default="nas")
    with pytest.raises(PublishError, match="^draft build; rebuild without --draft$"):
        publish(script, cfg)
    assert not (tmp_path / "pub").exists()


def test_refuse_out_of_date(tmp_path, script):
    make_build(script, tmp_path / "cache")
    script.write_text(script.read_text().replace("title: ", "title: Changed ", 1))
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub")}, default="nas")
    with pytest.raises(PublishError, match="^build is out of date; run vidgen build$"):
        publish(script, cfg)


def test_no_target(tmp_path, script):
    make_build(script, tmp_path / "cache")
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub")})
    with pytest.raises(PublishError, match=r"^no publish target; set publish\.default or pass --target$"):
        publish(script, cfg)
    with pytest.raises(PublishError, match='no publish target "nope"'):
        publish(script, cfg, target="nope")


def test_build_dir_override(tmp_path, script):
    d = make_build(script, tmp_path / "elsewhere")
    cfg = cfg_with(tmp_path, {"nas": LocalTarget(path=tmp_path / "pub")}, default="nas")
    m = publish(script, cfg, build_dir=d)
    assert json.loads((d / "build.json").read_text())["slug"] == m.slug


# --- the command --------------------------------------------------------------------------


def write_toml(script_path: Path, tmp_path: Path, extra: str = "") -> Path:
    p = script_path.parent / "vidgen.toml"
    p.write_text(
        f"""[paths]
cache = "{tmp_path / 'cache'}"
[publish]
default = "nas"
[publish.targets.nas]
type = "local"
path = "{tmp_path / 'pub'}"
public_base_url = "http://nas.local/vidgen"
{extra}""",
        encoding="utf-8",
    )
    return p


def test_cli_publish_local_writes_manifest(tmp_path, script):
    make_build(script, tmp_path / "cache")
    write_toml(script, tmp_path)
    r = runner.invoke(app, ["publish", str(script)])
    assert r.exit_code == 0, r.output
    h = video_sha()[:12]
    assert r.output == f"published dns-mini → http://nas.local/vidgen/dns-mini/{h}/video.mp4\n"
    mp = script.parent / "manifest.json"
    assert mp == manifest_path(script)
    m = read_manifest(mp)
    assert m is not None and m.version == 1 and m.target == "nas"
    assert m.files.video.location == (tmp_path / "pub" / "dns-mini" / h / "video.mp4").resolve().as_uri()
    assert (tmp_path / "pub" / "dns-mini" / h / "video.mp4").read_bytes() == BUILD_FILES["video.mp4"]

    # Without public_base_url the location is printed instead.
    other = script.parent / "nourl.toml"
    other.write_text(
        f"""[paths]
cache = "{tmp_path / 'cache'}"
[publish.targets.plain]
type = "local"
path = "{tmp_path / 'pub2'}"
""",
        encoding="utf-8",
    )
    r = runner.invoke(app, ["publish", str(script), "--config", str(other), "--target", "plain"])
    assert r.exit_code == 0, r.output
    assert r.output.startswith("published dns-mini → file://")

    # A PublishError exits 1 with its message.
    r = runner.invoke(app, ["publish", str(script), "--config", str(other)])
    assert r.exit_code == 1
    assert r.output == "error: no publish target; set publish.default or pass --target\n"


def test_republish_noop(tmp_path, script, monkeypatch):
    make_build(script, tmp_path / "cache")
    write_toml(script, tmp_path)
    monkeypatch.setattr(publish_mod, "_now", lambda: "2026-11-17T10:00:00Z")
    assert runner.invoke(app, ["publish", str(script)]).exit_code == 0
    mp = manifest_path(script)
    first = mp.read_bytes()
    published = sorted((tmp_path / "pub").rglob("*.*"))
    mtimes = [p.stat().st_mtime_ns for p in published]

    monkeypatch.setattr(publish_mod, "_now", lambda: "2026-11-18T09:00:00Z")
    r = runner.invoke(app, ["publish", str(script)])
    assert r.exit_code == 0, r.output
    assert mp.read_bytes() == first
    assert [p.stat().st_mtime_ns for p in published] == mtimes

    # A copy that actually happens (the published file went missing) updates publishedAt.
    (published[0]).unlink()
    assert runner.invoke(app, ["publish", str(script)]).exit_code == 0
    m = read_manifest(mp)
    assert m is not None and m.publishedAt == "2026-11-18T09:00:00Z"


def test_no_credentials_exit_2(tmp_path, script, monkeypatch):
    make_build(script, tmp_path / "cache")
    write_toml(script, tmp_path, extra="""[publish.targets.s3]
type = "s3"
bucket = "my-videos"
region = "eu-west-1"
""")

    class NoCreds:
        def head_object(self, **kw):
            raise NoCredentialsError()

        def upload_file(self, *a, **kw):
            raise NoCredentialsError()

    monkeypatch.setattr(boto3, "client", lambda *a, **kw: NoCreds())
    r = runner.invoke(app, ["publish", str(script), "--target", "s3"])
    assert r.exit_code == 2
    assert r.output == "s3: NoCredentials: Unable to locate credentials\n"
    assert not manifest_path(script).exists()

    from botocore.exceptions import ClientError

    class Denied(NoCreds):
        def head_object(self, **kw):
            raise ClientError({"Error": {"Code": "AccessDenied", "Message": "Access Denied"}}, "HeadObject")

    monkeypatch.setattr(boto3, "client", lambda *a, **kw: Denied())
    r = runner.invoke(app, ["publish", str(script), "--target", "s3"])
    assert r.exit_code == 2
    assert r.output == "s3: AccessDenied: Access Denied\n"
