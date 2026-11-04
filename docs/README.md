# Real tender documents

Public tender documents from four Indonesian public building projects, collected on 2026-11-03 and 2026-11-04 to try NorthTeak on real planning documents. Only [the two added last](#two-more-packages-added-2026-11-04) have structural drawings and records from the contract being carried out.

To try one, start a project of your own in the app and upload the whole folder under **Documents**. The app does not read these files until someone does that. **Plan it with Muse** then sends the pages the agents need to the Meta Model API. [tests/test_package.py](../tests/test_package.py) also reads the Unair and UGM packages, on this machine with a scripted model. [PROVENANCE.md](../PROVENANCE.md) says what is real and what is not.

The owners published these on their public-information (PPID) portals. The files are unchanged and name real officials and companies. The award records also show company tax numbers (NPWP), and some files carry signatures, so review them before this repository is made public.

## The first two packages

| | Unair: Airlangga Edupreneur Center, Tahap 1 | UGM: Gedung Pascasarjana FTP |
|---|---|---|
| Folder | [unair-airlangga-edupreneur-center-2024/](unair-airlangga-edupreneur-center-2024/) | [ugm-gedung-pascasarjana-ftp-2024/](ugm-gedung-pascasarjana-ftp-2024/) |
| Source | [Dokumen PLP](https://ppid.unair.ac.id/dokumen-plp/) | [Dokumen tahap pemilihan](https://ppid.ugm.ac.id/dokumen-pengadaan-barang-dan-jasa/dokumen-tahap-pemilihan-dalam-pengadaan-barang-dan-jasa/) |
| Location | Kampus B, Surabaya | Bulaksumur, Yogyakarta |
| Budget ceiling (pagu) | Rp 80,000,000,000 | Rp 43,305,516,000 |
| Owner's estimate (HPS) | Rp 78,410,429,000 | Rp 42,264,218,000 |
| Time for completion | 240 calendar days | 365 calendar days |
| Strongest part | The detailed BoQ | The 316-page RKS and the weekly schedule |

## What each one gives the app

The first column is the document `kind` that [swarm/package.py](../swarm/package.py) sorts a file into.

| Kind | Unair | UGM |
|---|---|---|
| `scope` | `KAK-AEC-2024.pdf`, 8 pages | `1-KAK-...pdf`, the opening sections |
| `drawing` | `II.-9.-Gambar-...pdf`, 16 architectural sheets, image only. They also cover the mosque package | `9-Gambar-...pdf`, sheets 1 to 6 of 189, all architectural |
| `spec` | Thin: the KAK has no slump or formwork requirements | `1-KAK-...pdf` holds the full RKS: concrete grades, slump, cover, testing. `3-Spesifikasi-Teknis-...pdf` adds 34 pages |
| `boq` | `Daftar-Kuantitas-Harga-...pdf`, 24 pages. Formwork, rebar and concrete per element and floor. **Prices are blank** | `7-Daftar-Kuantitas-...pdf`, a one-page recap of the winning bid. `2-HPS-...pdf`, a one-page recap of the estimate |
| `programme` | Overall duration only, in `Jadwal-...pdf`. Despite its name, this file is the LDP | `8-JADWAL-...pdf`, a 52-week S-curve with weights per floor. No crew numbers |
| `itp` | None | None. The RKS states test requirements, but there is no inspection plan |
| `method` (site logistics) | None | None |
| `rates` | None | None at unit level |

**Neither package has structural drawings**, so bar sizes, spacing and laps are unknown. The agents are told to ask for them, and not to guess. On the Unair package, they can only take the BoQ's rebar figure and cannot check it independently.

How the two packages differ for the app: UGM has a weekly schedule and a priced recap that code reads, but no quantities. Unair has quantities but no prices and no weekly schedule, so an agent has to draft the breakdown and estimate every date, and the work has no value yet. Its drawings are pictures, which the agents cannot read, and its folder holds a brief for another building (`KAK-Masjid-Nuruzzaman-1.pdf`), which a person has to leave out.

## Real problems already in the Unair documents

Nobody planted these, which makes them useful for testing. They come from a scan for rebar density under 40 or over 500 kg/m3. They could not be checked against structural drawings, so treat them as questions, not confirmed errors.

| BoQ line (Guest House 1) | Formwork | Rebar | Concrete | Why it looks wrong |
|---|---|---|---|---|
| Pondasi Lajur, 40 cm thick | 47.04 m2 | 30,393.38 kg | 18.82 m3 | 1,615 kg/m3, about 20% steel by volume |
| Retaining wall, 30 cm thick | 48.93 m2 | 1,136.10 kg | 86.41 m3 | 13 kg/m3. That concrete is 288 m2 of wall, against 48.93 m2 of formwork |
| Balok B3A, 200x500 | 49.32 m2 | 1,093.12 kg | 1.78 m3 | 614 kg/m3 |
| Balok Lift BL, 250x400 | 7.62 m2 | 392.60 kg | 0.65 m3 | 604 kg/m3 |

Also:

- `KAK-AEC-2024.pdf` says the BoQ is not binding ("BQ bersifat tidak mengikat").
- In the clarification minutes, a bidder asks which document governs if the KAK, RKS, drawings and BoQ differ. The answer to the post-clarification case only asks the bidder to be more specific, so the order of precedence stays unsettled.
- The same minutes promise a BoQ addendum, which is not in this set. **The BoQ here may be superseded.**

## A work item to check by hand

Unair, Guest House 1, Lantai 1 columns, from section V of the BoQ:

| Type | Size (mm) | Formwork (m2) | Rebar (kg) | Concrete (m3) |
|---|---|---|---|---|
| K1 | 500x600 | 132.00 | 7,255.49 | 18.00 |
| K2 | 450x450 | 36.00 | 1,598.46 | 4.05 |
| K3 | 350x350 | 22.40 | 738.31 | 1.96 |
| **Total** | | **190.40** | **9,592.26** | **24.01** |

Formwork and concrete agree with the section sizes: 60 m, 20 m and 16 m of column. Concrete is Fc' 30 MPa ready-mix.

## Files with little in them

Every file the two source pages link for these packages is here: 19 for UGM and 15 for Unair. Several add nothing to a plan, and the app sets most of them aside:

- **UGM 10, 13, 15 and 16:** identical files, a one-page note saying these documents do not apply to this tender.
- **UGM 11 and 12:** identical files, the winning bidder's signed one-page price letter for Rp 42.05 billion. It lists the BoQ and unit-price analysis as Excel attachments.
- **UGM 17 to 19:** award records. 18 and 19 are scans with no text layer, and neither has been read.
- **Unair `II-2-HPS.pdf` and `II-11.pdf`:** only links to the LPSE portal.
- **Unair bid and award records:** only their opening lines have been read.
- **Unair `KAK-Masjid-Nuruzzaman-1.pdf`:** the mosque package, not AEC.

## Still missing

Looked for on 2026-11-03 and not found in public:

- **Structural drawings for either building.** UGM published sheets 1 to 6 of 189.
- **The Unair BoQ addendum.**
- **UGM's detailed BoQ and unit-price analysis.**
- **UGM's signed contract and execution records.** The [contract register](https://ppid.ugm.ac.id/daftar-dokumen-kontrak-pengadaan-barang-dan-jasa/) lists the contract (PT Tigamas Mitra Selaras, 7.02/VIII/PPP-KP/UGM/2024, 2024-08-07) at Rp 43,462,005,000, with no file link found. That is Rp 1.41 billion above the winning bid and above the budget ceiling, and the register does not say why.
- **A student internship report on the AEC project** at [UPN Jatim](https://repository.upnjatim.ac.id/58753/). The site reset the connection, and search results describe its attachments as restricted to repository staff.

## Two more packages, added 2026-11-04

Neither has been through the app's analysis or sent to the Meta Model API.

| | UNP: Gedung II Hospitality Training Center | KKP: Laboratorium Pengujian Mutu, Wilayah Timur |
|---|---|---|
| Folder | [unp-gedung-ii-hospitality-training-center-2024/](unp-gedung-ii-hospitality-training-center-2024/) | [kkp-laboratorium-mutu-makassar-2026/](kkp-laboratorium-mutu-makassar-2026/) |
| Source | [Dokumen pengadaan](https://ppid.unp.ac.id/dokumen-pengadaan-barang-dan-jasa/), one page per document type | [Tahap pemilihan](https://ppid.kkp.go.id/laporan-dan-pbj/tahap/pemilihan/), package O, and [tahap pelaksanaan](https://ppid.kkp.go.id/laporan-dan-pbj/tahap/pelaksanaan/), package L |
| Owner | Universitas Negeri Padang | Balai PPMHKP Makassar, Ministry of Marine Affairs and Fisheries |
| Location | Kampus Air Tawar, Padang | Jl. Dakota 24, Sudiang, Makassar |
| Building | 5 floors and a roof, with guest rooms | 3 floors, 1,000 m2 |
| Budget ceiling (pagu) | Rp 48,000,000,000 | Rp 8,739,000,000 |
| Owner's estimate (HPS) | Rp 47,968,783,000 | Rp 8,738,970,000 |
| Contract | Rp 44,131,280,300, PT Bhinneka Citra Prima | Rp 6,991,176,000, CV Muthia Karya Mandiri |
| Time for completion | 300 calendar days, 21 February to 17 December 2025 | 180 calendar days, to 25 December 2026 |
| Size | 24 files, 93 MB | 16 files, 76 MB |
| Strongest part | 479 drawing sheets, the 140-page RKS, and a BoQ that gives bar sizes | The signed 26-week S-curve, drawings with a text layer, and the volume back-up |

### What each one gives the app

| Kind | UNP | KKP |
|---|---|---|
| `scope` | `KAK-HTC.pdf`, 347 pages. Its first 187 pages repeat `DKH-Ged-II-HTC.pdf`, and the RKS starts on page 208 | `1.a.KAK...pdf`, 13 pages |
| `drawing` | `Gambar-Rencana-...pdf`, 479 sheets of architecture, structure and MEP, image only. **Every sheet is numbered AR**, even the foundation, column, beam and slab plans (AR-1, AR-2, AR-10), so go by the sheet title | `1.c.GAMBAR...pdf`, 150 sheets of architecture, structure and MEP. 143 give some text and 128 more than a line or two, including column and beam sizes and the beam rebar schedule |
| `spec` | The RKS in `KAK-HTC.pdf`: piling, concrete, slump of 12 to 14 cm. `Spesifikasi-...pdf` adds a 19-page materials list | Thin: the 13-page document has no slump or cover requirements. Concrete grade K-300 is on the drawings |
| `boq` | `DKH-Ged-II-HTC.pdf`: 906 rows on pages 2 to 29. Beam rows give bar sizes, such as 20D22. **Prices are blank** | `7._Daftar-...pdf`, 111 pages: volume back-up with formulas and sketches up to page 27, the BoQ from page 28 with work codes, volumes and bar sizes, then rates. **Prices are blank** in the recap and the BoQ and analysis pages checked |
| `programme` | None. `Jadwal-...pdf` is only a link, and it opens the bidding timetable | Page 72 of `Laporan_Pelaksanaan_Timur.pdf`: 26 weeks, weights per work group, plan against actual, signed by the PPK. A scan, so a person has to enter it. `jadwal_...pdf` gives only scope and duration |
| `estimate` | `HPS-...pdf`, a one-page scan with totals by work group | `HPS_Wilayah_Timur.pdf` is a screenshot of the tender's winner page, with no breakdown |
| `contract` | Draft, 69 pages. Signed contract, a 4-page scan, and a one-page summary | Draft, 61 pages. Signed contract, a 64-page scan with one page of text |
| `rates` | Unit-price analysis on pages 31 to 187 of the DKH: coefficients, no prices | Unit-price analysis in the same file as the BoQ: coefficients, no prices |
| `itp`, `method` | None. The contract asks the contractor to write them | None. The contract asks the contractor to write them |

### Records from the work itself

- **KKP, `Laporan_Pelaksanaan_Timur.pdf`:** the supervising consultant's first monthly report, 185 pages, for 29 June to 26 July 2026. At day 28 of 180, the plan was 3.188%, actual was 5.727%, and deviation was +2.539%. Page 60 sets the plan for weeks 5 to 8. Pages 75 to 89 list the work items with volume, weight and progress in clean text, easier to read than the BoQ file. It also holds attendance sheets with photos of people, daily weather, material tests and the minutes of a progress meeting. Only the first month is published.
- **UNP, `Laporan-Pelaksanaan-Pek-HTC.pdf`:** a progress report for week 26, 11 to 17 August 2025, with weights by work group and 35.044% complete, about 177 of the 300 days in. `Surat-Tagihan-...pdf` is the payment claim that follows it.

### Real questions already in these documents

Nobody planted these. They have not been checked with the owners, so treat them as questions, not confirmed errors.

| Package | Where | What |
|---|---|---|
| KKP | Column K1 | The drawings (PDF pages 55 and 56) say 450x500. The BoQ on page 31 and the volume back-up on page 2 say 450x450, and the back-up says 400x400 on pages 5 and 7 |
| KKP | BoQ page 31 | Stray spreadsheet cells sit beside the table: `#REF!` and 577,500,000,000, which is far above the Rp 8.7 billion estimate |
| KKP | Start date | The contract summary says 30 June 2026. The report gives the SPMK as 29 June 2026 |
| UNP | Sheet AR-2.01, PDF page 48 | The same foundation sheet prints both "Mutu Beton K-250" and "Mutu Beton K300". The RKS only suggests a grade between K250 and K300 |
| UNP | Foundation | Not an error, but it binds the plan: `KAK-HTC.pdf` requires the patented KJRB foundation (patent 43873) to be subcontracted to a licence holder. `Sertifikat-atau-Lisensi-Pondasi.pdf` is the patent |

### How the app handles them on 2026-11-04

- **KKP drawings:** read, with text from 143 of the 150 pages. The PDF reader stops on pages 110 to 113, so those four sheets come out empty, and three more have no text.
- **UNP BoQ:** sorts as `boq`, and code reads its 906 rows from pages 2 to 29, with no prices.
- **KKP BoQ:** code reads 0 rows, although the file holds a real BoQ from page 28. The layout reading that keeps a table's rows together returns nothing for any of its 111 pages, and the plain reading gives the descriptions apart from their volumes. Pages 75 to 89 of `Laporan_Pelaksanaan_Timur.pdf` are the readable source of the same work items.
- **UNP drawings:** image only, so they are set aside as pictures.
- **Files that go to the model and hold company or personal data:** `Ringkasan-Kontrak-...pdf` shows the contractor's tax number, and `Laporan_Pelaksanaan_Timur.pdf` holds names. Set them aside if that matters.

### What is in the folders

- **KKP:** every file its two portal pages link, except one. The page links the same file as both KAK and specification, so one copy is kept. Items the page marks as not required are not files.
- **UNP:** every file its pages link for this package. The maintenance bond row links the advance payment bond again, so there is no maintenance bond here. `Persetujuan-Lingkungan-...pdf` is the environmental approval for the campus.
- **Payment and bank files:** `Jaminan-*`, `04._Jaminan-*`, `SPM-dan-SP2D-*` and `Surat-Tagihan-*` are bank guarantees and payment records, and the claim shows a bank account number. They are scans, so the app does not send them, but review them before this repository is made public.
- **Size:** `Gambar-Rencana-Gedung-II-HTC.pdf` is 53 MB. The app takes up to 64 MB per file, and GitHub warns above 50 MB.

### Still missing from these two

No soil investigation or structural calculations turned up in the text of either set. The scanned pages were sampled, not read in full. UNP has no construction schedule, and KKP has no monthly report after the first.

### Looked at and passed over

| Package | Why |
|---|---|
| [UNP Gedung Kuliah FT](https://ppid.unp.ac.id/gambar-rancangan-pekerjaan/) | A 530-page KAK and RKS, but its 50 drawing pages cover one building's architecture, out of three buildings. The schedule file is only a link |
| [KKP Gedung Administrasi II](https://ppid.kkp.go.id/laporan-dan-pbj/tahap/pemilihan/) | Its 8 "drawing" pages are renderings |
| [RS Moewardi Critical Center, Tahap II](https://ppid.rsmoewardi.com/wp-content/uploads/2024/08/Gambar-Pembangunan-Gedung-Critical-Center-dan-Pelayanan-Penunjang-Tahap-II.pdf) | The drawing file is 8 floor plans. No BoQ or schedule file was found |
| [Unair](https://ppid.unair.ac.id/dokumen-barjas/) 2022 package | The drawing file is one page |
| [Unsoed FIB 2025 and FT 2026](https://ppid.unsoed.ac.id/dokumen-pbj-tahap-pemilihan/), [Unsil FKIP](https://ppid.unsil.ac.id/tahap-pemilihan-pembangunan-gedung-fakultas-keguruan-dan-ilmu-pendidikan/) | Not checked. Unsoed refused the connection and Unsil returned 403 on 2026-11-04. Both list drawings and may be worth trying in a browser |
