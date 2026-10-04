FROM python:3.12-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY requirements-migrations.txt .
RUN pip install --no-cache-dir -r requirements-migrations.txt
COPY app app
COPY assets assets
COPY alembic.ini .
COPY migrations migrations
EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port 8000"]
