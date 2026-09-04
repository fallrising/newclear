# Cloud Key Provider Design (Superseded)

This document is **superseded** by [self-managed-key-design.md](self-managed-key-design.md).

The project intentionally does **not** ship AWS KMS, Azure Key Vault, or HashiCorp
Vault Transit adapters. Official key management is the self-managed
`FileKeyringProvider` keyring file. Operators who need remote backup encrypt that
file themselves before storing it off-host.
