# Market validation plan

## Objective

Validate that the local-first proposal solves a real problem before scaling
infrastructure, marketing or operational commitments.

## Hypotheses

1. Local privacy and control of the keys are purchase drivers, not just
   technical preferences.
2. Import from Pocket and portable export lower the switching barrier.
3. Users accept configuring their own AI key if the product clearly explains
   what data leaves the device.
4. Backup and restore are decisive for trust and must be measured together with
   activation.

## Evidence to gather

- Interviews and onboarding tests with consent.
- Landing-to-install and activation conversion.
- Time to first bookmark/document and backup completion.
- Successful restore rate, data-loss tickets and churn.
- Qualitative feedback segmented by technical/non-technical user.

Do not store vault content or unnecessary personal data in the experiments.
Analytics must be opt-in, aggregated and consistent with `docs/ROPA.md`.

## Decision criterion

Continue only if retention, activation and feedback confirm the hypothesis
without increasing privacy, support or recovery risk. Record every decision and
its evidence in a dated report; do not turn a small sample into a public claim.