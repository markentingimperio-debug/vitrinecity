FROM ubuntu:24.04
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends obs-studio obs-plugins ca-certificates xvfb xauth dbus-x11 python3 python3-websocket ffmpeg fonts-dejavu-core libgl1-mesa-dri && rm -rf /var/lib/apt/lists/*
RUN useradd -u 10001 -m -d /home/studio studio && mkdir /live-studio && chown studio:studio /live-studio
COPY worker.py relay.py bootstrap.py import-media.py /opt/studio/
USER 10001:10001
ENV HOME=/home/studio LIBGL_ALWAYS_SOFTWARE=1 QT_X11_NO_MITSHM=1
WORKDIR /home/studio
CMD ["python3", "/opt/studio/bootstrap.py"]
