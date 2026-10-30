FROM docker.io/library/node:24-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev \
    libxdo-dev libssl-dev patchelf xvfb xauth dbus-x11 file \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir /work && chown node:node /work
USER node
WORKDIR /work
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs -o /tmp/finance-rustup.sh \
    && sh /tmp/finance-rustup.sh -y --profile minimal --default-toolchain stable \
    && rm /tmp/finance-rustup.sh
ENV PATH="/home/node/.cargo/bin:${PATH}"
ENV CARGO_BUILD_JOBS=1
ENV APPIMAGE_EXTRACT_AND_RUN=1
