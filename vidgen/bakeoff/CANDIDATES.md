# TTS bake-off candidates

These are the open TTS models from spec §8 that are worth standing up as servers for `vidgen bakeoff`.
Kokoro is the **baseline**: it is small, fast and permissively licensed, and every other candidate has
to beat it by ear.

Every fact here was checked on the web on **2026-11-17** and cites its source. "Unverified" means no
page that was read confirmed it. Licenses and server projects change, so re-check a row before you
rely on it.

vidgen is only a client. Starting these servers, and their GPU and Python environments, is your job.
The spec constraint that matters most here is that the chosen model's license must allow the
generated audio to be redistributed, because published videos may be shared.

General sm_120 (RTX 5090, Blackwell) note: use a PyTorch build with cu128 or newer. Older wheels and
older vLLM images fail with `no kernel image is available` errors.
([vLLM forum: v0.9.0 image on 5090](https://discuss.vllm.ai/t/docker-image-vllm-vllm-openai-v0-9-0-doesnt-work-on-5090/761),
[vLLM forum: torch 2.9.0 cu128 setup](https://discuss.vllm.ai/t/vllm-on-rtx5090-working-gpu-setup-with-torch-2-9-0-cu128/1492)).
One vLLM 0.11.2 thread also reports segfaults on a 5090
([thread](https://discuss.vllm.ai/t/bug-segfault-in-pythonsymnodeimpl-and-deadlock-on-rtx-5090-blackwell-with-vllm-0-11-2/2688)).

## Summary

| Candidate | Version (checked) | License; may generated audio be redistributed? | EN / IT | OpenAI-compatible server (port) | sm_120 / CUDA 12.8 | Cloning |
|---|---|---|---|---|---|---|
| **Kokoro-82M (baseline)** | v1.0, 2025-01-27 (checked 2026-11-17) | Apache-2.0 weights; yes, no output restriction stated | yes / yes (2 voices, graded C) | remsky/Kokoro-FastAPI (8880) | `latest-cu128` image tag | no (preset voices) |
| Chatterbox | Multilingual V3 / Turbo / Nano; retired Aug 2026 (checked 2026-11-17) | MIT code and weights; yes, but outputs carry a PerTh watermark | yes / yes (Multilingual only) | devnen/Chatterbox-TTS-Server (8004) | cu128 compose file, explicit Blackwell support | yes, zero-shot |
| Higgs Audio | v3 (4B), v2/v2.5; no dates given (checked 2026-11-17) | v3: research/non-commercial, **no**. v2: community license, free under 100k annual active users, attribution required | yes / unverified | official vLLM image for v2 (8000) | unverified | yes, zero-shot |
| VibeVoice | Realtime-0.5B, 2025-12-03; TTS-1.5B code pulled 2025-09-05 (checked 2026-11-17) | MIT, but the card limits use to research; **no** for shared videos; audible disclaimer and watermark | yes / experimental | ncoder-ai/VibeVoice-FastAPI (8001) | cu128 install documented, Blackwell not mentioned | Large-7B only, on that server |
| Fish Speech / OpenAudio | Drama 3; S2-Pro (tech report Mar 2026) (checked 2026-11-17) | Fish Audio Community License: you own outputs, but commercial use is free only under USD 500k revenue. S2-Pro: research license, **no** | yes / listed ("it") | vLLM-Omni (8091 in docs) | unverified | yes, 10–30 s reference |
| IndexTTS2 | IndexTTS-2.5, 2026-08-10 (checked 2026-11-17) | bilibili Model Use License: outputs count as derivative works, commercial use means contacting bilibili; **unclear** | yes / no | azhao1981/index-tts-vllm (6006) | CUDA 12.8+ toolkit advised | yes, zero-shot |
| F5-TTS | v1 base, 2025-03-12 (checked 2026-11-17) | MIT code, CC-BY-NC weights; **no** | yes / community finetune only | jianchang512/f5-tts-api (5010) | torch 2.8.0+cu128 install line | yes, zero-shot |
| Orpheus TTS | 3B EN 2025-03-18; multilingual preview Apr 2025 (checked 2026-11-17) | Apache-2.0 on the cards; whether Llama terms apply is unverified | yes / yes (research preview) | Lex-au/Orpheus-FastAPI (5005) | unverified; upstream pins vLLM 0.7.3 | unreliable |
| Qwen3-TTS | 0.6B / 1.7B, 2026-01-22 (checked 2026-11-17) | Apache-2.0 code and weights; yes, no output restriction shown | yes / yes | vLLM-Omni (8091), or groxaxo/Qwen3-TTS-Openai-Fastapi (8880) | unverified | yes, 3 s zero-shot |

On licenses alone, the candidates that fit the redistribution constraint are Kokoro, Qwen3-TTS,
Chatterbox and, with research-preview caveats, Orpheus. Higgs v2 and the Fish Community License are
usable with conditions. The rest are non-commercial, research-only or unclear. The bake-off table
records each endpoint's `license` from `vidgen.toml`, so put the real one there.

Two defaults clash: Kokoro-FastAPI and the groxaxo Qwen3 server both use port 8880. Move one of them.

## Details

### Kokoro-82M (baseline), checked 2026-11-17

- **Version:** v1.0, released 2025-01-27. Nothing newer is listed ([model card](https://huggingface.co/hexgrad/Kokoro-82M)).
- **License:** the weights are Apache-2.0, and the card says it "has been deployed in numerous projects and commercial APIs". No restriction on outputs is stated ([model card](https://huggingface.co/hexgrad/Kokoro-82M)).
- **Languages:** 9, including English. Italian has 2 voices, `if_sara` and `im_nicola`, both graded C ([VOICES.md](https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md)).
- **Server:** [remsky/Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI), serving `/v1/audio/speech` on port 8880:
  `docker run --gpus all -p 8880:8880 ghcr.io/remsky/kokoro-fastapi-gpu:latest-cu128`
- **sm_120:** use the explicit `latest-cu128` tag. The plain `:latest` tag ships cu126.
- **Cloning:** no; it has preset voices only.

### Chatterbox (Resemble AI), checked 2026-11-17

- **Version:** Multilingual V3 (500M, 23+ languages), Turbo (350M, English), Nano (110M, English, CPU) and the original model. The README says "As of August 2026, Chatterbox is retired research and is no longer maintained" ([GitHub](https://github.com/resemble-ai/chatterbox)).
- **License:** code and weights are both MIT, with no clause about outputs. Every output carries a PerTh watermark ([model card](https://huggingface.co/ResembleAI/chatterbox)).
- **Languages:** English, and Italian in the Multilingual model only.
- **Server:** [devnen/Chatterbox-TTS-Server](https://github.com/devnen/Chatterbox-TTS-Server) supports Multilingual. Every example uses port 8004:
  `docker compose -f docker-compose-cu128.yml up -d --build`
- **sm_120:** Blackwell is supported explicitly. The cu128 option installs PyTorch 2.9 with cu128 and needs driver 570+, and the README says CUDA 12.1 builds fail with "no kernel image". On a manual install, use `--no-deps` for chatterbox, or it downgrades torch.
- **Cloning:** zero-shot from a reference clip (`audio_prompt_path`). The README advises a reference in the same language as the text.

### Higgs Audio (Boson AI), checked 2026-11-17

- **Version:** v3 (`bosonai/higgs-audio-v3-tts-4b`) is the latest. The v2 and v2.5 docs moved to README_V2.md. No release dates are given ([GitHub](https://github.com/boson-ai/higgs-audio)).
- **License:** the code is Apache-2.0.
  - The v3 weights are under a "Research and Non-Commercial License", and commercial use needs a separate license.
  - The v2 weights are under the Boson Higgs Audio 2 Community License, which builds on the Llama 3 license. It is free below 100,000 annual active users, requires "Built with Higgs Materials" attribution, and bars using outputs to improve other LLMs ([v2 LICENSE](https://huggingface.co/bosonai/higgs-audio-v2-generation-3B-base/blob/main/LICENSE)).
- **Languages:** English yes. Italian is unverified: v3 claims 100+ languages, and the v2 card doesn't name its languages.
- **Server:** official, for v2, serving `/v1/audio/speech` on port 8000 ([vLLM example](https://github.com/boson-ai/higgs-audio/tree/main/examples/vllm)):
  `docker run --gpus all --ipc=host --shm-size=20gb --network=host bosonai/higgs-audio-vllm:latest --served-model-name higgs-audio-v2-generation-3B-base --model bosonai/higgs-audio-v2-generation-3B-base --audio-tokenizer-type bosonai/higgs-audio-v2-tokenizer --limit-mm-per-prompt audio=50 --max-model-len 8192 --port 8000 --gpu-memory-utilization 0.8 --disable-mm-preprocessor-cache`
  v3 starts with `sgl-omni serve --model-path bosonai/higgs-audio-v3-tts-4b --port 8000`. Whether that is OpenAI-compatible is unverified.
- **sm_120:** unverified. The recommended image is NGC pytorch 25.01/25.02, with a 24 GB+ GPU, tested on an RTX 4090 ([README_V2](https://github.com/boson-ai/higgs-audio/blob/main/README_V2.md)).
- **Cloning:** zero-shot, from a voice-presets directory on the v2 server.

### VibeVoice (Microsoft), checked 2026-11-17

- **Version:** the TTS-1.5B code came out 2025-08-25 and was removed on 2025-09-05 over misuse. Realtime-0.5B came out 2025-12-03, with experimental multilingual voices on 2025-12-16. Releases since then are ASR only ([GitHub](https://github.com/microsoft/VibeVoice)).
- **License:** MIT, but the card limits use to research and advises against commercial use. Outputs embed an audible AI disclaimer and a watermark ([model card](https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B)).
- **Languages:** English. Italian is an experimental voice only, and the card says the model was trained on English.
- **Server:** community project [ncoder-ai/VibeVoice-FastAPI](https://github.com/ncoder-ai/VibeVoice-FastAPI), on port 8001: `docker-compose up -d`
- **sm_120:** that server documents a cu128 torch install. Blackwell itself is not mentioned.
- **Cloning:** on that server, Large-7B clones from files in `VOICES_DIR`, and 1.5B has "no voice cloning". Microsoft forbids cloning a voice without consent.

### Fish Speech / OpenAudio (fishaudio), checked 2026-11-17

- **Version:** Drama 3 (35B-A3B) is the latest, after S2-Pro (5B, tech report March 2026). The README no longer mentions S1. No exact dates are given ([GitHub](https://github.com/fishaudio/fish-speech), [S2-Pro card](https://huggingface.co/fishaudio/s2-pro)).
- **License:** the [Fish Audio Community License v1.0](https://raw.githubusercontent.com/fishaudio/fish-speech/main/LICENSE) covers code and weights.
  - "You own any outputs", but they can't train other models, and real voices can't be imitated without consent.
  - Commercial use is free only below USD 500k annual revenue, and hosted generation services are not allowed.
  - Distributors must show "Built with Fish Audio".
  - The S2-Pro weights are under the non-commercial Fish Audio Research License.
- **Languages:** English, and Italian listed only as "it" among 80+ languages on the S2-Pro card.
- **Server:** [vLLM-Omni](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/speech_api/), serving `/v1/audio/speech`. The docs use port 8091, but the default is unverified:
  `vllm serve fishaudio/s2-pro --omni --port 8091`
  Whether Fish's own API server is OpenAI-compatible is unverified.
- **sm_120:** unverified.
- **Cloning:** yes, from 10–30 s of reference audio.

### IndexTTS2 (bilibili), checked 2026-11-17

- **Version:** IndexTTS-2.5, released 2026-08-10. IndexTTS-2 came out 2025-09-08 ([GitHub](https://github.com/index-tts/index-tts)).
- **License:** the [bilibili Model Use License](https://raw.githubusercontent.com/index-tts/index-tts/main/LICENSE).
  - It is royalty-free, with a separate license needed above 100M monthly active users or RMB 1B revenue.
  - "Derivative Work" includes model outputs, and outputs can't be used to improve other models.
  - PRC law applies, and the Chinese text prevails.
  - The README says to contact indexspeech@bilibili.com for commercial use.
- **Languages:** Chinese, English, Japanese, Spanish and Arabic. Italian is not listed.
- **Server:** community project [azhao1981/index-tts-vllm](https://github.com/azhao1981/index-tts-vllm), on port 6006 at `/audio/speech`, without `/v1`. Set `base_url` to the server root. Its changelog warns the OpenAI API may have bugs.
  `python api_server_v2.py --model_dir <model dir>`
  There is also a [vLLM-Omni recipe for 2.5](https://recipes.vllm.ai/IndexTeam/IndexTTS-2.5).
- **sm_120:** the README says to install CUDA Toolkit 12.8+ if you get CUDA errors. There are no 5090-specific reports.
- **Cloning:** zero-shot from one reference clip, with emotion and duration controls.

### F5-TTS (SWivid), checked 2026-11-17

- **Version:** no tagged release. The latest news is the v1 base model, 2025-03-12 ([GitHub](https://github.com/SWivid/F5-TTS)).
- **License:** the code is MIT. The pretrained weights are CC-BY-NC because of the Emilia training data.
- **Languages:** the official weights are Chinese and English. Italian exists only as the community finetune [alien79/F5-TTS-italian](https://huggingface.co/alien79/F5-TTS-italian) (cc-by-4.0), which its own discussion calls "far from production ready".
- **Server:** community project [jianchang512/f5-tts-api](https://github.com/jianchang512/f5-tts-api), on port 5010 at `/v1`, WAV only. The voice is passed as `ref.wav###transcript`.
  `python api.py`
- **sm_120:** the README installs `torch==2.8.0+cu128 torchaudio==2.8.0+cu128`. Blackwell isn't mentioned.
- **Cloning:** zero-shot via a reference audio and its text.

### Orpheus TTS (Canopy Labs), checked 2026-11-17

- **Version:** the 3B English model came out 2025-03-18, and a multilingual research preview in April 2025 ([GitHub](https://github.com/canopyai/Orpheus-TTS)).
- **License:** the code is Apache-2.0, and the weights are tagged Apache-2.0 on the cards. They are built on a Llama 3B backbone, and whether Llama terms apply is unverified ([model card](https://huggingface.co/canopylabs/orpheus-3b-0.1-ft)).
- **Languages:** English. Italian comes via [`canopylabs/3b-es_it-ft-research_release`](https://huggingface.co/canopylabs/3b-es_it-ft-research_release), a research preview.
- **Server:** community project [Lex-au/Orpheus-FastAPI](https://github.com/Lex-au/Orpheus-FastAPI), serving `/v1/audio/speech` on port 5005, WAV only. It needs a separate LLM backend (llama.cpp in its compose file), and lists Italian voices pietro, giulia and carlo.
  `docker compose -f docker-compose-gpu.yml up`
- **sm_120:** unverified. Orpheus-FastAPI installs from the cu124 index, and upstream pins `vllm==0.7.3`, which predates Blackwell support. Expect to need a newer vLLM or the llama.cpp backend.
- **Cloning:** listed as zero-shot, but the README says it "wasn't explicitly trained" for it.

### Qwen3-TTS (Alibaba Qwen), checked 2026-11-17

- **Version:** Qwen3-TTS 0.6B and 1.7B, released 2026-01-22 ([GitHub](https://github.com/QwenLM/Qwen3-TTS)).
- **License:** code and weights are Apache-2.0, and no clause restricts outputs ([model card](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)).
- **Languages:** 10, including English and Italian.
- **Server:** the Qwen repo says online serving is "to be supported later". There are two routes meanwhile.
  - [vLLM-Omni](https://docs.vllm.ai/projects/vllm-omni/en/latest/serving/speech_api/), on port 8091:
    `vllm serve Qwen/Qwen3-TTS-12Hz-1.7B-Base --omni --port 8091 --trust-remote-code --enforce-eager --deploy-config vllm_omni/deploy/qwen3_tts.yaml`
  - Community project [groxaxo/Qwen3-TTS-Openai-Fastapi](https://github.com/groxaxo/Qwen3-TTS-Openai-Fastapi), on port 8880: `docker compose up --build qwen3-tts-gpu`. It accepts language aliases such as `tts-1-it`.
- **sm_120:** unverified. The install needs FlashAttention 2 and bf16/fp16.
- **Cloning:** 3-second zero-shot with the Base checkpoints.

## How to run a bake-off

1. **Start the servers** you want to compare on the GPU box, using the commands above. Keep each
   server's port distinct. Check one with `curl http://127.0.0.1:<port>/v1/models`, or the path its
   README gives.
2. **Add them to `vidgen.toml`** under `[tts.endpoints]`, with the real license, then list them
   under `[bakeoff]`. Configure an `[align]` endpoint too, such as speaches or another faster-whisper
   server; without one, the "Cue words aligned" column reads `n/a`.

   ```toml
   [tts.endpoints.kokoro]
   base_url = "http://127.0.0.1:8880/v1"
   model = "kokoro"
   voice = "af_heart"
   license = "Apache-2.0"

   [tts.endpoints.qwen3]
   base_url = "http://127.0.0.1:8091/v1"
   model = "Qwen/Qwen3-TTS-12Hz-1.7B-Base"
   license = "Apache-2.0"

   [bakeoff]
   endpoints = ["kokoro", "qwen3"]
   ```

3. **Run** `vidgen doctor` to confirm every endpoint answers, then run `vidgen bakeoff`. You can also
   pass `--endpoints kokoro,qwen3` or `--out dir`. Clips go to `vidgen/bakeoff/clips/`, which is
   gitignored, as `<endpoint>-raw.wav` (no dictionary) and `<endpoint>-dict.wav` (with it). The table
   goes to `vidgen/bakeoff/results.md`.
4. **Listen** to every pair. Judge the technical words (DNS, TTL, TLD, nginx, example.com, IPv6 and
   93.184.216.34), the pacing and the naturalness. Fill in VRAM and Notes by hand.
5. **Pick one** and set it as the default in `vidgen.toml`, for example `[tts] endpoint = "qwen3"`.
   Check its license row above once more: the generated audio must be redistributable.
