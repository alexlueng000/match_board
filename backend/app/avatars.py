"""Store validated, re-encoded avatars; never trust client paths or file names."""

from io import BytesIO
from pathlib import Path
import secrets
import warnings

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, UnidentifiedImageError

AVATAR_DIR = Path(__file__).resolve().parents[1] / "uploads" / "avatars"
AVATAR_DIR.mkdir(parents=True, exist_ok=True)
MAX_BYTES = 5 * 1024 * 1024


def read_avatar(upload: UploadFile):
    raw = upload.file.read(MAX_BYTES + 1)
    if not raw or len(raw) > MAX_BYTES:
        raise HTTPException(422, "请选择不超过5MB的头像图片")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as source:
                if source.format not in {"JPEG", "PNG", "WEBP"}:
                    raise HTTPException(422, "头像仅支持 JPG、PNG 或 WebP 图片")
                if source.width * source.height > 16_000_000:
                    raise HTTPException(422, "头像图片尺寸过大，请选择较小的图片")
                image = ImageOps.exif_transpose(source).convert("RGB")
                image = ImageOps.fit(image, (256, 256), method=Image.Resampling.LANCZOS)
                output = BytesIO()
                image.save(output, format="JPEG", quality=85)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError,
            Image.DecompressionBombWarning):
        raise HTTPException(422, "头像图片无法读取，请重新选择")


def store_avatar(content):
    name = secrets.token_hex(16) + ".jpg"
    path = AVATAR_DIR / name
    try:
        path.write_bytes(content)
    except OSError:
        path.unlink(missing_ok=True)
        raise HTTPException(503, "头像暂时无法保存，请稍后重试")
    return "/assets/avatars/" + name, path
