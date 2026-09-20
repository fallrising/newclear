---
id: SDD-0000
title: <short feature title>
status: draft
owner: <owner>
risk: low # low | medium | high | critical
data_class: internal # public | internal | confidential | restricted
budget_usd: 0
allowed_paths:
  - src/<component>/**
forbidden_paths:
  - .github/workflows/**
  - orchestration/policies/**
---

# <Feature title>

## Context
Why this change is needed and the problem it solves.

## Goals
- G-1: <observable outcome>

## Non-goals
- <explicitly excluded behavior>

## User stories
- As a <role>, I can <capability>, so that <benefit>.

## Functional requirements
- FR-1: <behavior and boundary>

## Non-functional requirements
- NFR-1: <security, performance, reliability, or operational constraint>

## Acceptance criteria
Scenario: <primary success path>
Given <precondition>
When <action>
Then <observable result>

Scenario: <important failure or boundary path>
Given <precondition>
When <action>
Then <safe, observable result>

## Failure modes
- <failure>: <fail-closed behavior and recovery/rollback>

## Open questions
- <question, owner, and decision deadline>
