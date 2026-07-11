# Navigation Observation Contract

A Navigation Observation contains stable ID, Session/window refs, source, action, target, optional visible object hint, observed request/correlation refs, and booleans for observed, reload verified, new-tab verified, cross-session verified, and unstable. Reload/New-tab operations occur only after an explicit Sidecar/API action. Cross-session verification creates a new observation/ref and never edits old Session Raw.
