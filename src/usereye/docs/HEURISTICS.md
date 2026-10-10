# UserEye heuristic triage and accepted patterns

UserEye separates a confirmed or reviewable finding from an intentional UI pattern.
The distinction is explicit in `result.json`:

- `kind: "defect"` — deterministic breakage;
- `kind: "risk"` — contextual problem that needs review;
- `kind: "signal"` — informational heuristic;
- `kind: "opinion"`, `triage: "accepted-pattern"` — a recognized intentional pattern.

Accepted patterns remain in `issuesAll` with `surfaced: false` under the default
`findings.minConfidence: "medium"`. This preserves evidence without mixing them into
the primary `issues` list. HTML and Markdown reports render them in **Perception
heuristics (opinion)** below the confirmed findings. Accepted patterns never fail an
`observe` severity gate.

## Recognized accepted patterns

| Pattern ID                                | Recognition rule                                                                                                                                                         | Why it is accepted                                                                             |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `decorative-aria-hidden-in-named-control` | A rendered `svg`, `img`, `role=presentation`, or `role=none` has `aria-hidden=true` inside a parent control with a non-empty `aria-label` or resolved `aria-labelledby`. | The graphic is decorative; the parent control supplies the accessible name.                    |
| `screen-reader-only-clipping`             | Text overflows a standard `sr-only`, `visually-hidden`, or `screen-reader` class, or uses the equivalent absolute 1–2 px clipped/hidden geometry.                        | Intentional clipping is a standard technique for content exposed only to assistive technology. |
| `tooltip-complements-accessible-name`     | An icon-like control has `title`/`data-tooltip` and also has a non-tooltip accessible name from `aria-label`, `aria-labelledby`, or a native label.                      | The tooltip is supplementary; the control does not depend on hover for its name.               |

Near misses that do not satisfy the complete rule retain their original finding
(`visible-aria-hidden`, `text-overflow`, or `hover-only-content`). Evidence includes
the selector and the recognized pattern ID so the decision is auditable.

## `eternal-skeleton` acceptance rule

A loading-looking element is inspected after `document.readyState === "complete"`.
A progress indicator is accepted when all of the following hold:

1. it has `role="progressbar"`;
2. `aria-valuenow` is numeric and within its range;
3. `aria-valuemax` is numeric and positive, or uses the ARIA implicit default of `100`;
4. measurable progress is at least **4%**.

Measurable progress is the greater of the ARIA value ratio and a visible child fill
ratio. Visual fill uses `getBoundingClientRect()`, so transformed fills such as
`transform: scaleX(...)` are measured, not just CSS `width`.

When the rule fails, `evidence[].missing` states exactly what is absent, alongside
`ariaProgressPercent`, `visualFillPercent`, `measurableProgressPercent`, and the full
criterion. This heuristic does not wait for application data indefinitely; use a
real progressbar or remove stale loading classes/`aria-busy=true` when loading ends.

## Contrast and positioned sibling overlays

For axe `color-contrast` violations, UserEye checks the target's center for a
positioned sibling painted behind a transparent text element (for example a sliding
navigation pill). If found, the axe node and issue technical details include a
`sibling-overlay-background` hint naming:

- the text target;
- the sibling overlay;
- the background axe can measure in the target/ancestor chain.

A sibling can be visible to a person without being the target's computed background.
Give the element containing the text its own `background-color`, or verify contrast
against the ancestor background reported by axe.

## `observe` exit codes

Unexpected browser errors always exit `1`. Accepted opinions never do. Other findings
follow `--fail-on`:

```text
--fail-on never | minor | major | critical | blocker
```

Omitting the flag keeps the historical behavior for non-opinion findings: any
surfaced finding exits `1`. For a CI gate that tolerates minor review items, use
`--fail-on major`.
