#!/usr/bin/env python3
"""Fetches one whole AMI meeting (CC-BY-4.0) with its annotation, for the benchmark.

    uv run --with duckdb 10-fetch-ami-meeting.py IS1009a 0
    uv run --with duckdb 10-fetch-ami-meeting.py TS3003a 0

The second argument is the test shard the meeting lives in (0, 1 or 2); list them
with a query on audio.path if unsure. Writes public/testdata/ami-<ID>.wav (16 kHz
mono) and ami-<ID>.truth.json in the same shape as ami-ES2004a.truth.json. Nothing
is committed.
"""
import json
import pathlib
import subprocess
import sys

import duckdb

meeting, shard = sys.argv[1], sys.argv[2]
URL = ("https://huggingface.co/datasets/diarizers-community/ami/resolve/main/"
       f"sdm/test-0000{shard}-of-00003.parquet")
out = pathlib.Path(__file__).resolve().parents[1] / "public" / "testdata"
out.mkdir(parents=True, exist_ok=True)

con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs;")
audio, starts, ends, speakers = con.execute(
    f"SELECT audio.bytes, timestamps_start, timestamps_end, speakers "
    f"FROM read_parquet('{URL}') WHERE audio.path = '{meeting}.Array1-01.wav'"
).fetchone()

raw = out / f"ami-{meeting}.raw.wav"
raw.write_bytes(audio)
subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", str(raw), "-ar", "16000", "-ac", "1",
                str(out / f"ami-{meeting}.wav")], check=True)
raw.unlink()

turns = sorted(({"startMs": int(s * 1000), "endMs": int(e * 1000), "speaker": who}
                for s, e, who in zip(starts, ends, speakers)), key=lambda t: t["startMs"])
(out / f"ami-{meeting}.truth.json").write_text(json.dumps({
    "meeting": meeting,
    "source": "AMI Corpus, single distant microphone (CC-BY-4.0)",
    "speakers": sorted({t["speaker"] for t in turns}),
    "turns": turns,
}, indent=1))
print(f"{meeting}: {len(turns)} turns, {len(set(speakers))} speakers, "
      f"{turns[-1]['endMs'] / 60000:.1f} min -> public/testdata/")
