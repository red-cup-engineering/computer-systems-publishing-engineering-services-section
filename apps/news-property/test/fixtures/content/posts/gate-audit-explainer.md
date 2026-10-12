---
title: "How the Newsroom's Deterministic Gates Decide What Gets Published"
date: 2026-07-01
draft: false
section: "world"
author: "Nik Koios"
description: "A walkthrough of the deterministic gates every draft article passes before publication, and what they do not establish."
summary: "Every draft article passes numeric-citation, attribution, and duplicate-source gates before publication. This explainer names what the gates check and what they leave for a human or a correction."
keywords: ["editorial gates", "claim ledger", "corrections"]
categories: ["Newsroom"]
claims: [{"text":"Every published article passes a numeric-citation gate before release.","source":"https://koios.news/standards"},{"text":"A duplicate-source gate rejects drafts backed by a single outlet.","source":"https://koios.news/standards"}]
omissions: [{"text":"This article does not establish how often the gates reject a draft outright versus return it for revision."}]
corrections: [{"date":"2026-07-02","note":"Corrected the number of deterministic gates described below from three to four."}]
---

Every article that reaches Koios.News passes through four deterministic gates before a human or an assessment model ever reads it: a numeric-citation gate, an attribution gate, a quote-fidelity gate, and a duplicate-source gate.

## What the gates check

The numeric-citation gate rejects a draft that states a figure without a source attached to the sentence that carries it.
The attribution gate rejects a draft that quotes or paraphrases a claim without naming who made it.
The duplicate-source gate rejects a draft backed by a single outlet when the desk's `minimumIndependentSources` requires more than one.

## What the gates do not establish

A gate that passes a draft is not a claim that the draft is true.
It is a claim that the draft is *sourced* in the specific, narrow ways the gate checks for.
The independent assessment pass — run on a different model lineage than the one that drafted the article — is where broader judgment enters, and even that pass is recorded as a receipt, not treated as proof.

> The gates are a floor, not a verdict.
