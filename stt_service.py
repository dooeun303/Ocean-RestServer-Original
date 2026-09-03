"""
해수담수화 AR - MP3/WAV 음성 전사(STT) 서비스.

무료 STT 중 정확도/속도가 가장 좋은 faster-whisper(오픈소스 Whisper 재구현)를 그대로 노출한다.
Unity(SpeechToTextTestDemo.cs)가 기대하는 계약과 동일하게 응답한다:

    POST /api/stt   (multipart/form-data, 필드명 "file")
      -> 200  { "success": true,  "text": "인식된 문장" }
      -> 4xx  { "success": false, "error": "..." }

실행:
    pip install -r requirements.txt
    # ffmpeg 필요 (48kHz/스테레오 등 아무 wav/mp3/ogg를 faster-whisper가 읽을 때 사용)
    #   Windows: https://www.gyan.dev/ffmpeg/builds/ 에서 받아 PATH 등록
    uvicorn stt_service:app --host 0.0.0.0 --port 8900

모델/장치는 환경변수로 조정:
    WHISPER_MODEL    tiny | base | small(기본) | medium | large-v3
    WHISPER_DEVICE   cpu(기본) | cuda
    WHISPER_COMPUTE  int8(기본, CPU) | float16(GPU 권장) | int8_float16
GPU가 있으면 WHISPER_DEVICE=cuda WHISPER_COMPUTE=float16 WHISPER_MODEL=large-v3 가 한국어 최상.
"""

import os
import tempfile

from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from faster_whisper import WhisperModel

MODEL_NAME = os.getenv("WHISPER_MODEL", "small")
DEVICE = os.getenv("WHISPER_DEVICE", "cpu")
COMPUTE = os.getenv("WHISPER_COMPUTE", "int8")

# 첫 로드 때 모델을 내려받는다(small ~ 500MB, large-v3 ~ 3GB). 이후 캐시.
print(f"[stt] loading faster-whisper model={MODEL_NAME} device={DEVICE} compute={COMPUTE}")
model = WhisperModel(MODEL_NAME, device=DEVICE, compute_type=COMPUTE)
print("[stt] model ready")

app = FastAPI(title="AR STT service")

# Unity 에디터/기기에서 직접 호출하므로 CORS 완화(사내망 전용).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"success": True, "model": MODEL_NAME, "device": DEVICE}


@app.post("/api/stt")
async def stt(file: UploadFile = File(...)):
    data = await file.read()
    if not data:
        return JSONResponse(status_code=400, content={"success": False, "error": "empty file"})

    suffix = os.path.splitext(file.filename or "audio.wav")[1] or ".wav"
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp.write(data)
            tmp_path = tmp.name

        # language="ko" 고정(현장 언어). vad_filter로 앞뒤 무음/잡음 구간을 잘라 정확도/속도 개선.
        segments, info = model.transcribe(
            tmp_path,
            language="ko",
            vad_filter=True,
            beam_size=5,
        )
        text = "".join(seg.text for seg in segments).strip()
        return {"success": True, "text": text, "duration": round(info.duration, 2)}
    except Exception as e:  # noqa: BLE001 - 어떤 실패든 계약대로 JSON으로 돌려준다
        return JSONResponse(status_code=500, content={"success": False, "error": str(e)})
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.remove(tmp_path)
