# Phase 0 spike — throwaway

Feasibility probe, not application code. Nothing here ships. Findings are recorded in
`docs/adr/0001-neural-speaker-embeddings-in-the-browser.md`; this directory is kept
only so the numbers in that ADR can be reproduced.

    npm install
    # test audio (not committed):
    mkdir -p audio && cd audio
    for f in 1-two-speakers-en.wav 2-two-speakers-en.wav 0-four-speakers-zh.wav; do
      curl -LO "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/$f"
    done && cd ..

    node 01-segmentation.js ./audio/1-two-speakers-en.wav        # segmentation sanity check
    node 02-embeddings.js   ./audio/1-two-speakers-en.wav q8     # same/different separation gap
    node 03-pipeline.js     ./audio/0-four-speakers-zh.wav q8 4  # threshold sweep
    node 04-known-k.js      ./audio/0-four-speakers-zh.wav q8 4  # clustering with K known

Browser benchmark (needs cross-origin isolation for multi-threaded WASM):

    cd bench && cp ../audio/2-two-speakers-en.wav test.wav && python3 serve.py 8765
    # open http://127.0.0.1:8765/ and read the console
