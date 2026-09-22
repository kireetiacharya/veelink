# veelink

# Veelink: Enterprise Interoperability Gateway 🚀
*Smart India Hackathon (SIH) Prototype*

Veelink is a production-grade, secure middleware gateway designed to bridge isolated legacy government departmental databases with native platforms like DigiLocker. It guarantees compliance with the Digital Personal Data Protection (DPDP) Act through automated consent mechanisms, data minimization toggles, and cryptographic transaction seals.

---

## 🏛️ System Architecture & Workflow
* **Tier 1 (DigiLocker Native Vault):** Instantly resolves queries if documents already exist in the citizen's DigiLocker vault (e.g., Driving License lookup).
* **Tier 2 (Gateway Fallback & Schema Translation):** Automatically triggers when records reside in isolated legacy silos (e.g., Revenue Dept records), translating custom schemas on-the-fly without altering core gateway logic.
* **DPDP Consent Engine:** Requires explicit citizen authorization via cryptographically signed consent tokens, featuring a data minimization mode to fetch eligibility flags instead of raw sensitive attributes.
* **Cryptographic Integrity & Audit:** Secures payloads with SHA-256 HMAC signatures paired with an officer verification tool and an immutable real-time audit ledger dashboard (`/audit`).

---

 🛠️ Tech Stack
* **Backend:** Node.js, Express.js, JSON Web Tokens (JWT)
* **Security & Cryptography:** Node `crypto` module (SHA-256 file checksums, HMAC-SHA256 payload sealing)
* **Frontend UI:** HTML5, Tailwind CSS
* **Data Layer:** File-backed JSON document store simulating departmental silos

---


## 📁 File Architecture
## 📁 File Architecture
```text
veelink/
├── documents/
│   ├── REVENUE_24eg111a18.json       # Legacy Revenue Dept database record
│   └── TRANSPORT_24eg111a18.json    # Legacy Transport Dept database record
├── node_modules/                    # Installed backend dependencies
├── .gitignore                       # Git ignore configuration
├── package.json                     # Node.js project manifest and dependency tracker
├── package-lock.json                # Exact dependency tree lockfile
├── server.js                        # Express backend (Auth, Vault, Consent, HMAC)
├── index.html                       # Enterprise frontend UI portal
└── audit.html                       # Immutable DPDP audit ledger dashboard

npm install express cors jsonwebtoken

node server.js
