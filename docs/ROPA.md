# Record of Processing Activities (ROPA)

## Controller and scope

The data controller must complete legal and contact data in the business environment before launch. This record describes the current architecture of BookmarkForge and its technical boundaries.

## Data processed

- Account or license data necessary to activate paid plans.
- Minimum technical security and diagnostic data, with limited retention.
- Aggregated analytics events only after explicit consent.
- Vault content: remains locally and is not sent to the companion server as part of normal operation.

## Purpose and legal basis

- Service provision and support: contract execution.
- Security, abuse prevention and availability: documented legitimate interest.
- Optional analytics and remote errors: consent, revocable from the application.

## Providers and transfers

External providers must be listed in the controller's contractual inventory, with DPA and international transfer review when applicable. AI provider keys are stored in the user's vault and calls are made from the browser according to the chosen configuration.

## Retention and rights

Operational data is retained only for the period necessary for security, support and legal obligations. Requests for access, rectification, deletion and opposition must be recorded and addressed through the privacy channel defined by the operator.

## Technical measures

Local encryption, access control, rate limiting, CSP, SAST, dependency auditing, controlled backups and incident response procedures. This document must be reviewed when changing providers, endpoints or data categories.
