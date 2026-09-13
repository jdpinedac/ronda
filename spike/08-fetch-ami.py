#!/usr/bin/env python3
"""Extracts a benchmark excerpt from the AMI Corpus (CC-BY-4.0).

AMI is meeting audio recorded with a single distant microphone — the same
situation Ronda is built for — and it comes with human annotation of who spoke
when, which is what makes measurement possible at all.

    python3 -m venv venv && venv/bin/pip install duckdb
    venv/bin/python 08-fetch-ami.py

Writes public/testdata/ami-meeting.wav and ami-meeting.truth.json. Neither is
committed; the audio is 5.7 MB and rebuilding it takes under a minute.
"""
import json
import pathlib
import subprocess

import duckdb

URL = ("https://huggingface.co/datasets/diarizers-community/ami/resolve/main/"
       "sdm/test-00002-of-00003.parquet")
MEETING = "ES2004a.Array1-01.wav"
# Chosen by scanning for the three-minute window with the most even split;
# the opening minutes are one person presenting, which tests little.
START_MS, WINDOW_MS = 780_000, 180_000

out = pathlib.Path(__file__).resolve().parents[1] / "public" / "testdata"
out.mkdir(parents=True, exist_ok=True)

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
audio, starts, ends, speakers = con.execute(
    f"SELECT audio.bytes, timestamps_start, timestamps_end, speakers "
    f"FROM read_parquet('{URL}') WHERE audio.path = '{MEETING}'"
).fetchone()

full = out / "ami-full.wav"
full.write_bytes(audio)
subprocess.run(
    ["ffmpeg", "-v", "error", "-y", "-i", str(full),
     "-ss", str(START_MS / 1000), "-t", str(WINDOW_MS / 1000),
     "-ar", "16000", "-ac", "1", str(out / "ami-meeting.wav")],
    check=True)
full.unlink()

turns = []
for s, e, who in zip(starts, ends, speakers):
    a, b = max(int(s * 1000), START_MS), min(int(e * 1000), START_MS + WINDOW_MS)
    if b > a:
        turns.append({"startMs": a - START_MS, "endMs": b - START_MS, "speaker": who})
turns.sort(key=lambda t: t["startMs"])

(out / "ami-meeting.truth.json").write_text(json.dumps({
    "meeting": "AMI ES2004a, 13:00-16:00, single distant microphone",
    "source": "AMI Corpus (CC-BY-4.0) via diarizers-community/ami, config sdm",
    "durationMs": WINDOW_MS,
    "speakers": sorted({t["speaker"] for t in turns}),
    "turns": turns,
}, indent=1))

print(f"{len(turns)} turns, {len(set(speakers))} speakers -> public/testdata/")
