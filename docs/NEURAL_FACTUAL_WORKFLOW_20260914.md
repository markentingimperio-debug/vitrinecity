# Neural: functional factual drafts and honest response states

## Scope of this correction

The administrator requested the failures to be corrected immediately. Earlier
diagnostic reports are historical: their model promotion remains blocked, but
that does not prevent shipping independently tested code/UI corrections with
autonomous tasks and AI billing still disabled.

- Marketing exposes the requested action rather than always dispatching diagnosis.
- Six prose skills accept multiline input while metadata/path, length and secret
  safeguards remain in force. The console applies each area's actual input limit.
- A length-limited or filtered response is incomplete, not completed learning or
  provider success. Its partial text and usage receipt remain available; no second
  provider is invoked automatically to replace it.
- A new authenticated, same-origin `/api/admin/vitriny-neural/factual-draft`
  endpoint formats up to 30 supplied factual statements, 500 characters each.
  It never calls a model, stores the content, publishes, contacts a customer,
  creates tasks or debits credits. Statements remain literal in lines, paragraphs
  or bullets, with all required facts retained.
- The console explicitly says these are supplied facts, not externally verified
  truth. It renders text safely and checks the returned text against the exact
  selected format before allowing copy.
- Qualifications for a different configured model alias no longer enable the
  active provider or falsely indicate readiness; historical reports remain saved
  and explicit administrative evaluation remains possible.

This is a reliable formatting workflow, **not training or proof that a generative
model now understands all requests correctly**. The normal administrative model
test remains diagnostic. Merchant tasks, qualification thresholds, money and
autonomy are not enabled or weakened by this correction.

## Real-model diagnostic conclusion

A bounded isolated 4B diagnostic compared the current system policy with a
minimal system policy while holding model, user request, temperature, output
budget and seeds fixed (three cases, three seeds, two variants; 18 calls).
Product drafts still invented softness/comfort/durability and omitted the
no-filling exclusion. Some support drafts contradicted the unconfirmed shipping
status. Simplifying the system policy did not establish reliability and was not
adopted. The diagnostic finished; its container was stopped, without production
model replacement or qualification import. No further prompt-only claim is made.

## Verification and release conditions

The new regression cases reproduced the UI/input/incomplete failures before their
fixes. Module/API tests verify literal equality, required facts, malformed input,
limits, request provenance and no provider calls. A real-server smoke test uses
an ephemeral database, blocked outbound networking, actual admin authorization,
and disabled Neural/task flags to verify that factual drafting still works.

Release requires the complete Neural suite, existing platform regressions,
Linux/container checks, independent review and live public/authenticated UI
checks. Preserve the current image and Git revision for rollback; deploy only
the application. Do not remove executor containers, volumes or production data.
Record actual deployment results separately; this document alone does not prove
that deployment has occurred.
