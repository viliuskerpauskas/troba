# Glossary

The words troba uses for its domain, in specs, issues, tests and code. One context: the money module and the identity it depends on.

## Money

**Financial account**:
A place a user's money lives and their transactions belong to: a bank account, cash, or another kind.
_Avoid_: wallet; "account" alone where it could mean the user's sign-in account

**Statement file**:
A file a user downloads from their bank listing one financial account's transactions, in any supported format (CSV, spreadsheet or PDF).
_Avoid_: CSV (for the file in general), export, upload (as a noun)

**Import**:
Uploading a statement file to add its transactions to a financial account. The only way bank transactions reach troba; there is no bank sync.
_Avoid_: sync, upload

**Import profile**:
A user's saved description of one bank's tabular statement file format (CSV or spreadsheet): which columns hold which fields, and how to read dates and amounts.
_Avoid_: schema, template, mapping
