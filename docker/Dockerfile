FROM node:22-bookworm

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       bash ca-certificates curl git jq openssh-client \
       python3 python3-pip python3-venv \
       ripgrep procps util-linux build-essential pkg-config \
    && rm -rf /var/lib/apt/lists/*

RUN corepack enable
WORKDIR /workspace
CMD ["sleep", "infinity"]
