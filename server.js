const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/audit', (req, res) => res.sendFile(path.join(__dirname, 'audit.html'))); // <-- ADD THIS LINE

const JWT_SECRET = 'sih_2026_veelink_master_key';
const DOCUMENTS_DIR = path.join(__dirname, 'documents');

// In-Memory Data Stores
const auditLedger = [];
const revokedTokens = new Set();

// ----------------------------------------------------------------------------
// 1. CITIZEN IDENTITY AUTHENTICATION SERVER
// ----------------------------------------------------------------------------
const CITIZEN_ACCOUNTS = {
  "24eg111a18": {
    password: "password123",
    full_name: "Kireeti Acharya",
    mobile: "+91 9876543210",
    aadhaar_linked: true
  }
};

app.post('/api/v1/auth/login', (req, res) => {
  const { citizenId, password } = req.body;
  const user = CITIZEN_ACCOUNTS[citizenId];

  if (!user || user.password !== password) {
    return res.status(401).json({ success: false, error: "Invalid Citizen ID or Password" });
  }

  const sessionToken = jwt.sign(
    { citizenId, full_name: user.full_name, auth_level: "AADHAAR_VERIFIED" },
    JWT_SECRET,
    { expiresIn: '1h' }
  );

  auditLedger.push({
    transaction_id: `AUTH-${crypto.randomUUID()}`,
    citizen_id: citizenId,
    channel: "CITIZEN_LOGIN_PORTAL",
    status: "AUTH_SUCCESS",
    timestamp: new Date().toISOString()
  });

  return res.json({
    success: true,
    message: "Citizen Authenticated Successfully",
    session_token: sessionToken,
    citizen: { id: citizenId, name: user.full_name, mobile: user.mobile }
  });
});

// ----------------------------------------------------------------------------
// 2. TIER 1: DIGILOCKER VAULT SERVICE
// ----------------------------------------------------------------------------
const DIGILOCKER_VAULT = {
  "24eg111a18": {
    "DRIVING_LICENSE": {
      doc_id: "DL-MH12-99812",
      issued_by: "Ministry of Road Transport and Highways",
      holder_name: "Kireeti Acharya",
      valid_thru: "2044-08-14",
      status: "ISSUED"
    }
  }
};

app.get('/api/v1/digilocker/vault/:citizenId/:docType', (req, res) => {
  const { citizenId, docType } = req.params;
  const userVault = DIGILOCKER_VAULT[citizenId];

  if (userVault && userVault[docType]) {
    auditLedger.push({
      transaction_id: `DL-${crypto.randomUUID()}`,
      citizen_id: citizenId,
      channel: "DIGILOCKER_VAULT",
      status: "SUCCESS_FETCH",
      doc_type: docType,
      timestamp: new Date().toISOString()
    });

    return res.json({
      status: "FOUND_IN_DIGILOCKER",
      source: "DigiLocker Vault Service",
      document: userVault[docType]
    });
  }

  auditLedger.push({
    transaction_id: `DL-MISS-${crypto.randomUUID()}`,
    citizen_id: citizenId,
    channel: "DIGILOCKER_VAULT",
    status: "DOCUMENT_NOT_FOUND",
    doc_type: docType,
    timestamp: new Date().toISOString()
  });

  return res.status(404).json({
    status: "NOT_FOUND_IN_DIGILOCKER",
    message: `Document '${docType}' not found in citizen's DigiLocker vault.`,
    recommended_action: "TRIGGER_VEELINK_INTEROPERABILITY_GATEWAY"
  });
});

// ----------------------------------------------------------------------------
// 3. TIER 2: VEELINK INTEROPERABILITY GATEWAY
// ----------------------------------------------------------------------------

// Physical File Ingestion & Checksum Engine
class DocumentRepository {
  static getDocument(departmentKey, citizenId) {
    const filename = `${departmentKey.replace('_DEPT', '')}_${citizenId}.json`;
    const filePath = path.join(DOCUMENTS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      throw new Error(`Document file '${filename}' not found for department '${departmentKey}'`);
    }

    const fileBuffer = fs.readFileSync(filePath);
    const fileSha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    const documentJson = JSON.parse(fileBuffer.toString('utf-8'));

    return { filePath: filename, fileChecksum: fileSha256, documentData: documentJson };
  }
}

// Declarative Schema Translation Engine (Supports DPDP Data Minimization)
const SCHEMA_MAPPINGS = {
  REVENUE_DEPT: {
    FULL: (doc) => ({
      citizen_fullname: doc.certificate_body.appl_name,
      annual_income_inr: Number(doc.certificate_body.inc_amt),
      eligibility_status: Number(doc.certificate_body.inc_amt) <= 800000 ? "ELIGIBLE_EWS_SCHEME" : "NON_EWS",
      issuing_authority: `${doc.document_header.issuing_office}, Govt of ${doc.document_header.issuing_state}`,
      document_type: doc.document_header.doc_type
    }),
    MINIMIZED: (doc) => ({
      citizen_fullname: doc.certificate_body.appl_name,
      is_eligible_ews: Number(doc.certificate_body.inc_amt) <= 800000,
      issuing_state: doc.document_header.issuing_state,
      document_type: doc.document_header.doc_type
    })
  }
};

class TranslationEngine {
  static transform(deptKey, rawDoc, mode = 'FULL') {
    const deptRules = SCHEMA_MAPPINGS[deptKey];
    if (!deptRules) throw new Error(`No schema mapping defined for department: ${deptKey}`);

    const transformFn = deptRules[mode] || deptRules['FULL'];
    return transformFn(rawDoc);
  }
}

// Issue DPDP Consent Token
app.post('/api/v1/auth/consent-token', (req, res) => {
  const { citizenId, requestedDept, targetDept, minimizationMode } = req.body;

  if (!citizenId || !requestedDept || !targetDept) {
    return res.status(400).json({ success: false, error: "Missing consent parameters" });
  }

  const token = jwt.sign(
    { citizenId, requestedDept, targetDept, mode: minimizationMode || 'FULL' },
    JWT_SECRET,
    { expiresIn: '300s' }
  );

  return res.json({ success: true, consent_token: token, expires_in: "300 seconds" });
});

// Revoke DPDP Consent Endpoint
app.post('/api/v1/auth/revoke-consent', (req, res) => {
  const { consentToken } = req.body;
  if (!consentToken) return res.status(400).json({ success: false, error: "Token required" });

  revokedTokens.add(consentToken);

  auditLedger.push({
    transaction_id: `REVOKE-${crypto.randomUUID()}`,
    channel: "CITIZEN_PORTAL",
    status: "CONSENT_REVOKED",
    timestamp: new Date().toISOString()
  });

  return res.json({ success: true, message: "Consent token revoked immediately." });
});

// Gateway Interoperability Fetch
app.post('/api/v1/gateway/interoperability-fetch', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ success: false, error: "Missing Authorization header. JWT token required." });
  }

  const token = authHeader.split(' ')[1];

  if (revokedTokens.has(token)) {
    return res.status(403).json({ success: false, error: "Access Denied: Citizen has REVOKED this consent token." });
  }

  let consentClaims;
  try {
    consentClaims = jwt.verify(token, JWT_SECRET);
  } catch (err) {
    return res.status(403).json({ success: false, error: "Consent token invalid or expired." });
  }

  const { citizenId, requestedDept, mode } = consentClaims;

  try {
    const docResult = DocumentRepository.getDocument(requestedDept, citizenId);
    const normalizedPayload = TranslationEngine.transform(requestedDept, docResult.documentData, mode);

    const txId = `TX-${crypto.randomUUID()}`;
    const payloadHash = crypto.createHmac('sha256', JWT_SECRET)
                              .update(JSON.stringify(normalizedPayload) + txId)
                              .digest('hex');

    const ledgerEntry = {
      transaction_id: txId,
      citizen_id: citizenId,
      channel: "VEELINK_INTEROPERABILITY_GATEWAY",
      source_dept: requestedDept,
      data_mode: mode,
      document_file: docResult.filePath,
      file_sha256_checksum: docResult.fileChecksum,
      payload_hmac_signature: payloadHash,
      timestamp: new Date().toISOString()
    };
    auditLedger.push(ledgerEntry);

    return res.json({
      success: true,
      gateway_metadata: {
        transaction_id: txId,
        channel: "VEELINK_GATEWAY",
        data_mode: mode,
        timestamp: ledgerEntry.timestamp,
        document_source_file: docResult.filePath,
        raw_file_sha256: docResult.fileChecksum
      },
      payload: normalizedPayload,
      cryptographic_proof: {
        algorithm: "SHA-256-HMAC",
        signature: payloadHash
      }
    });

  } catch (err) {
    return res.status(404).json({ success: false, error: err.message });
  }
});

// Officer Signature Verification Endpoint
app.post('/api/v1/gateway/verify-signature', (req, res) => {
  const { payload, transactionId, signatureToVerify } = req.body;

  if (!payload || !transactionId || !signatureToVerify) {
    return res.status(400).json({ success: false, error: "Missing parameters for verification." });
  }

  const recomputedHash = crypto.createHmac('sha256', JWT_SECRET)
                               .update(JSON.stringify(payload) + transactionId)
                               .digest('hex');

  const isValid = (recomputedHash === signatureToVerify);

  return res.json({
    verified: isValid,
    status: isValid ? "AUTHENTIC_DATA_UNTAMPERED" : "SIGNATURE_MISMATCH_TAMPERED",
    recomputed_hash: recomputedHash
  });
});

// Admin Audit Ledger Endpoint
app.get('/api/v1/admin/audit-ledger', (req, res) => {
  res.json({ total_transactions: auditLedger.length, ledger: auditLedger });
});

app.listen(5000, () => console.log('Veelink Production Interoperability Gateway running on http://localhost:5000'));