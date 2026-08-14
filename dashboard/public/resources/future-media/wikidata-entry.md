# Wikidata Entry Draft — Future Media AG

Create at https://www.wikidata.org → "Create a new item". Every statement should
carry a reference (official website or Zefix registry entry).

| Property | Value |
|---|---|
| Label (en / de) | Future Media AG |
| Description (en) | digital media agency in Zurich, Switzerland |
| instance of (P31) | business enterprise (Q4830453) |
| country (P17) | Switzerland (Q39) |
| headquarters location (P159) | Zurich (Q72) |
| inception (P571) | 1 March 2016 |
| official website (P856) | https://futuremedia-demo.ch/ |
| street address (P6375) | Bahnhofstrasse 100, 8001 Zurich |
| phone number (P1329) | +41 44 555 01 23 |
| email address (P968) | hello@futuremedia-demo.ch |
| industry (P452) | advertising agency (Q35649) |
| number of employees (P1128) | 14 (point in time: 2026) |
| Swiss UID (P… commercial register ID) | CHE-000.000.000 (from zefix.ch) |

**After saving:** note the QID (Q########), then:
1. Replace `Q0000000` in the homepage JSON-LD `sameAs` array with the real QID.
2. Add the QID to the Crunchbase and LinkedIn profiles.
3. Re-run `audit.py futuremedia-demo.ch "Future Media AG"` — Module D should pass.
