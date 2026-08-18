# Benchmarking the pipeline

A **frozen** requirement, replayed cold every time the pipeline configuration changes. The same words, the same starting point, the same measurements — that is the only way to know whether a change to the pipeline improved or degraded anything.

Without it, an observed gain is inseparable from its heaviest confounder: an operator discovering a repository and an operator who knows it do not produce the same throughput, and no store metric tells the two apart.

This document carries the **protocol**, which holds for any project. The frozen requirement belongs to the repository: it lives in `benchmarks_dir` with the results, and means nothing anywhere else.

## What is frozen, and what is not

**Frozen**: the text of the requirement, word for word. The starting commit, by its tag. The measurement commands.

**Free**: the decomposition into issues, the order, the number of cycles, the implementation. That is exactly what we want to measure — Product decomposes as it sees fit, and its decomposition is part of the result.

Never rewrite the requirement to "help" a run. A retouched requirement invalidates every earlier comparison, and the temptation will come precisely on the day a run goes badly.

## What a good benchmark requirement demands

It must **cross the project's whole chain** without introducing a new dependency — an operator block in the middle of a run makes the durations incomparable.

It must carry a **real design decision** rather than a mechanical sequence: a pipeline that only follows orders would succeed at a trivial CRUD without proving anything.

And it must be **genuinely absent** from the repository at the starting tag, verified rather than assumed. A requirement already implemented measures the ability to read existing code, not to produce.

## Protocol

1. `git checkout -b bench/<date> <starting tag>` — never from the default branch, which moves.
2. `node agent-pipeline/scripts/benchmark.mjs --start` — records the instant, the tag, and the configuration fingerprint.
3. Give the requirement, word for word, and run the pipeline normally.
4. `node agent-pipeline/scripts/benchmark.mjs --finish` — measures and appends a line to `runs.jsonl`.
5. **Recover the measurement and the discoveries onto the default branch before discarding anything.** `runs.jsonl` is written on the run branch, so deleting that branch erases the result — the defect was found on a project's first run, where the measurement and eighteen findings were about to disappear with the code they described. The discoveries are often worth more than the feature produced: three from that run concerned gates that did not measure what they announced.
6. Delete the branch. **A run's output is not code to keep**, it is a measurement — but the measurement is kept.

## Reading the results without fooling yourself

**A run is a sample of one.** Two executions of the same configuration will give different numbers — model temperature, order of discoveries, tooling luck. At least two runs per configuration before concluding anything.

**The configuration fingerprint is what makes comparison possible.** It hashes the prompts, the documents, the rules and the profile config. Two runs with different fingerprints do not compare term by term: they compare two pipelines.

**Duration is the noisiest and most seductive indicator.** The ones that count are escaped defects, cycles per issue, and criteria verified on the first pass. A run twice as fast that lets a defect escape is a worse run.

**The confounder the protocol does not remove**: the underlying model changes over time. A gap between two runs months apart mixes the effect of your configuration with the effect of the model. Recording the date and the model in every run is the minimum; not concluding from runs too far apart is the real discipline.

## When porting

The configuration's `benchmarks_dir` designates the results directory. **Its contents belong to the origin project**: when installing the pipeline elsewhere, empty it. A new repository starting with another's `runs.jsonl` compares two projects without knowing it, and inherits a frozen requirement describing an application it does not have.
