# Refactor 210 task F: the speaker-embedding service for a Phala Cloud dstack
# CVM (Intel TDX, linux/amd64).
#
# The model comes from a named build context, so the repo holds no copy:
#   docker build --platform linux/amd64 \
#     --build-context model=../../../seams-wallet/packages/voiceid/assets \
#     -t seams-speaker-service .
# (build.sh does this.) Both stages are linux/amd64, so the binary is a native
# x86_64-unknown-linux-gnu build. tract picks its AVX2/FMA/AVX-512 kernels at
# run time, so there is no target-cpu flag.

FROM --platform=linux/amd64 rust:1.97.1-slim-bookworm@sha256:2775a09d208ff0d7c1f50490c45b62db929e87ba1dcbc3f2132ac71a704bcdd3 AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src src
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/src/target \
    cargo build --release --locked --target x86_64-unknown-linux-gnu \
 && cp target/x86_64-unknown-linux-gnu/release/speaker-service /speaker-service

FROM --platform=linux/amd64 debian:bookworm-20261020-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8
COPY --from=build /speaker-service /usr/local/bin/speaker-service
COPY --from=model redimnet-b1.onnx /app/redimnet-b1.onnx
# The service checks this digest again at start, before it builds the plan.
RUN echo "e04dd7a6a1e23fc7b89e47682ea9d0a3946cf7bc59d07922c3db3efc52ae4269  /app/redimnet-b1.onnx" | sha256sum -c -
ENV SPEAKER_LISTEN=0.0.0.0:8080 \
    SPEAKER_MODEL_PATH=/app/redimnet-b1.onnx \
    DSTACK_SOCKET=/var/run/dstack.sock
EXPOSE 8080
# Root, so the process can open the guest agent socket that dstack mounts.
ENTRYPOINT ["/usr/local/bin/speaker-service"]
