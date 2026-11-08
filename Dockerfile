# Forge: static site + World's Edge proxy + replay companion in one small container.
#   docker build -t forge .
#   docker run -p 8000:8000 -e FORGE_ADMIN_KEY=change-me forge
FROM python:3.12-slim
WORKDIR /app
COPY . .
ENV HOST=0.0.0.0 PORT=8000 PYTHONUNBUFFERED=1
EXPOSE 8000
CMD ["python", "server.py"]
