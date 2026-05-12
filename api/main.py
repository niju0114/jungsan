import io
import os

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
import msoffcrypto
from msoffcrypto.exceptions import InvalidKeyError

CORS_ORIGINS = os.getenv(
    "CORS_ORIGIN",
    "https://jungsan-hae.com,https://www.jungsan-hae.com",
).split(",")

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB

limiter = Limiter(key_func=get_remote_address)
app = FastAPI(docs_url=None, redoc_url=None)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {"ok": True}


@app.post("/decrypt")
@limiter.limit("10/minute")
async def decrypt(
    request: Request,
    file: UploadFile = File(...),
    password: str = Form(...),
):
    data = await file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="FILE_TOO_LARGE")
    try:
        src = io.BytesIO(data)
        dst = io.BytesIO()
        f = msoffcrypto.OfficeFile(src)
        f.load_key(password=password)
        f.decrypt(dst)
        return Response(
            content=dst.getvalue(),
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        )
    except InvalidKeyError:
        raise HTTPException(status_code=400, detail="WRONG_PASSWORD")
    except Exception:
        raise HTTPException(status_code=400, detail="DECRYPT_FAILED")
