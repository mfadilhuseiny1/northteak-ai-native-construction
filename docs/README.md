# Real tender documents

Public tender documents from two Indonesian university building projects, collected on 2026-11-03 to try SiteSwarm on real planning documents.

To try one, start a project of your own in the app and upload the whole folder under **Documents**. The app does not read these files until someone does that. **Plan it with Muse** then sends the pages the agents need to the Meta Model API. [tests/test_package.py](../tests/test_package.py) also reads them, on this machine with a scripted model. [PROVENANCE.md](../PROVENANCE.md) says what is real and what is not.

Both universities published these on their public-information (PPID) portals. The files are unchanged and name real officials and companies. The award records also show company tax numbers (NPWP), and some files carry signatures, so review them before this repository is made public.

## The two packages

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
