# Optional CPU/pairs reproducibility recipe; see README.md for acceptance status.
FROM --platform=linux/amd64 docker.io/library/python:3.12.11-slim-bookworm@sha256:519591d6871b7bc437060736b9f7456b8731f1499a57e22e6c285135ae657bf7
ARG SOURCE_REVISION=unrecorded
LABEL org.opencontainers.image.title="OfftargetPred local pair scoring" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="$SOURCE_REVISION"
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 \
    PYTHONPATH=/app/backend HF_HUB_OFFLINE=1 TRANSFORMERS_OFFLINE=1 \
    OFFTARGET_DATA_DIR=/data OFFTARGET_MODEL_DIR=/models OFFTARGET_DEVICE=cpu \
    OFFTARGET_RELEASE_ID=$SOURCE_REVISION OMP_NUM_THREADS=4 OPENBLAS_NUM_THREADS=1 \
    XDG_CACHE_HOME=/tmp/cache
WORKDIR /app
COPY deploy/container/requirements-cpu.lock /app/requirements-cpu.lock
RUN python -m pip install --no-cache-dir --no-deps torch==2.4.1+cpu --index-url https://download.pytorch.org/whl/cpu \
    && python -m pip install --no-cache-dir --no-deps -r /app/requirements-cpu.lock \
    && python -m pip check
COPY backend /app/backend
COPY LICENSE THIRD_PARTY_NOTICES.md /app/
RUN chmod -R a=rX /app/backend && mkdir /data && chown 10001:10001 /data && chmod 700 /data
USER 10001:10001
CMD ["python", "-m", "uvicorn", "offtargetpred.api:create_app", "--factory", "--host", "0.0.0.0", "--port", "8010", "--no-access-log", "--no-proxy-headers"]
