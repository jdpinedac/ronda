# Comparing speaker embedding models

sherpa-onnx (k2-fsa) publishes a family of ONNX speaker embedding models that are
drop-in alternatives to the WeSpeaker ResNet34 Ronda uses, all taking 80-bin fbank and
differing only in architecture and output dimension. They live at
[csukuangfj/speaker-embedding-models](https://huggingface.co/csukuangfj/speaker-embedding-models).

    mkdir -p altmodels && cd altmodels
    curl -LO "https://huggingface.co/csukuangfj/speaker-embedding-models/resolve/main/wespeaker_en_voxceleb_CAM%2B%2B_LM.onnx"

Read a model's declared preprocessing from its ONNX metadata before using it:

    python3 -m venv venv && venv/bin/pip install onnx
    venv/bin/python -c "
    import onnx
    m = onnx.load('altmodels/campplus.onnx', load_external_data=False)
    for p in m.metadata_props: print(p.key, '=', p.value)
    print([(i.name, [d.dim_value or d.dim_param for d in i.type.tensor_type.shape.dim]) for i in m.graph.input])
    "

**The metadata is not sufficient on its own.** CAM++ declares `normalize_samples = 0`
and no `feature_normalize_type`, which reads as "no mean normalisation". Run that way
it scores far worse than the model it would replace. With mean normalisation on — the
same setting WeSpeaker ResNet34 uses — it beats it. Always measure both ways.

## Measured on `two-women.wav` (AMI, two women, distant mic, true split 60/40)

| Model | Output dim | DER | Confusion | ms/embedding |
|---|---|---|---|---|
| WeSpeaker ResNet34 (current) | 256 | 0.400 | 25.3 s | 358 |
| CAM++, no mean normalisation | 512 | 0.512 | 52.6 s | 169 |
| **CAM++, mean normalisation** | 512 | **0.380** | **20.3 s** | **169** |

**Confirmed on three whole four-speaker meetings on 2026-09-15, and it does not hold
up.** Scored with the oracle floor from ADR 0005 (every segment assigned to its
annotated speaker's centroid), CAM++ with mean normalisation gives 0.317, 0.296 and
0.381 against WeSpeaker int8's 0.306, 0.292 and 0.385 — the same floor. The two-women
gain is real (baseline 0.346 against 0.402) but disappears once splinters are placed
back (0.356 against 0.330). Not worth 29 MB. Reproduce with
`EMB=span EMB_MODEL=campplus npm run bench -- bench/embedding.report.ts` followed by
`REC=campplus npm run bench -- bench/score.report.ts`.

Size is the open question: CAM++ ships as 29 MB fp32 against the 6.7 MB int8 build
Ronda serves today. A quantised CAM++ would need producing and re-measuring, since
ADR 0001 found int8 costs about 10% of the separation gap.
