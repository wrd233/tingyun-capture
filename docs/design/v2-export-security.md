# v2 Export Security Design

Private export copies explicit Task metadata, research indexes, Session Raw/Derived, AI-ready, downloads, and integrity evidence. Browser profiles, environment files, shell history, external credentials, and recursive export directories are ineligible.

Shareable export starts from an empty staging directory. It generates only the research entry point, redacted Task/index data, strictly redacted Session analysis files, stable tokenization report, integrity/omission/validation data, and security reports. It never copies the Task root and deletes files afterward.

High-risk headers, cookies, Bearer/JWT material, secret fields, environment files, browser-profile markers, private mappings, and local home paths block publication. Internal origins, hosts/IPs, and configured business identifiers receive consistent task-wide tokens. The private mapping is never written to Shareable. The staging directory and final ZIP entries both must scan PASS.
