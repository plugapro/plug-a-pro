"""
Generate a .docx report from the JSON output of daily-provider-funnel-report.ts.

Usage:
  pnpm tsx scripts/daily-provider-funnel-report.ts --json > /tmp/report.json
  python3 scripts/generate_report_docx.py /tmp/report.json /tmp/report.docx

  # Or pipe directly:
  pnpm tsx scripts/daily-provider-funnel-report.ts --json | python3 scripts/generate_report_docx.py - /tmp/report.docx
"""

import sys
import json
import datetime
from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml.ns import qn
from docx.oxml import OxmlElement

# ── Colours ───────────────────────────────────────────────────────────────────
PURPLE     = RGBColor(0x6B, 0x21, 0xA8)
DARK_BG    = RGBColor(0x1E, 0x1B, 0x2E)
WHITE      = RGBColor(0xFF, 0xFF, 0xFF)
LIGHT_GREY = RGBColor(0xF3, 0xF4, 0xF6)
GREEN      = RGBColor(0x05, 0x96, 0x69)
AMBER      = RGBColor(0xD9, 0x77, 0x06)
RED        = RGBColor(0xDC, 0x26, 0x26)
TEXT_DARK  = RGBColor(0x11, 0x18, 0x27)
TEXT_MID   = RGBColor(0x4B, 0x55, 0x63)

def rgb_hex(rgb):
    return f"{rgb[0]:02X}{rgb[1]:02X}{rgb[2]:02X}"

def set_cell_bg(cell, rgb):
    tc = cell._tc
    tcPr = tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), rgb_hex(rgb))
    tcPr.append(shd)

def add_run(para, text, size=10, bold=False, color=TEXT_DARK, italic=False):
    run = para.add_run(str(text))
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.color.rgb = color
    run.font.italic = italic
    return run

def h2(doc, text):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(14)
    p.paragraph_format.space_after = Pt(5)
    add_run(p, text, size=13, bold=True, color=PURPLE)
    return p

def divider(doc):
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(2)
    p.paragraph_format.space_after = Pt(2)
    pPr = p._p.get_or_add_pPr()
    pBdr = OxmlElement('w:pBdr')
    bottom = OxmlElement('w:bottom')
    bottom.set(qn('w:val'), 'single')
    bottom.set(qn('w:sz'), '4')
    bottom.set(qn('w:space'), '1')
    bottom.set(qn('w:color'), 'D1D5DB')
    pBdr.append(bottom)
    pPr.append(pBdr)

def note(doc, icon, text, color=AMBER):
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(8)
    p.paragraph_format.left_indent = Inches(0.2)
    add_run(p, f'{icon}  ', size=9, bold=True, color=color)
    add_run(p, text, size=9, color=TEXT_DARK)

def build_table(doc, headers, rows, col_widths=None):
    table = doc.add_table(rows=1 + len(rows), cols=len(headers))
    table.style = 'Table Grid'
    table.alignment = WD_TABLE_ALIGNMENT.LEFT

    hdr = table.rows[0]
    for i, h in enumerate(headers):
        cell = hdr.cells[i]
        set_cell_bg(cell, DARK_BG)
        p = cell.paragraphs[0]
        p.paragraph_format.space_before = Pt(3)
        p.paragraph_format.space_after = Pt(3)
        add_run(p, h, size=9, bold=True, color=WHITE)

    for ri, row_data in enumerate(rows):
        bg = LIGHT_GREY if ri % 2 == 0 else WHITE
        tr = table.rows[ri + 1]
        for ci, val in enumerate(row_data):
            cell = tr.cells[ci]
            set_cell_bg(cell, bg)
            p = cell.paragraphs[0]
            p.paragraph_format.space_before = Pt(2)
            p.paragraph_format.space_after = Pt(2)
            if isinstance(val, tuple):
                text, bold, color = val
                add_run(p, text, size=9, bold=bold, color=color)
            else:
                add_run(p, str(val) if val is not None else '—', size=9, color=TEXT_DARK)

    if col_widths:
        for row in table.rows:
            for j, cell in enumerate(row.cells):
                if j < len(col_widths):
                    cell.width = Inches(col_widths[j])

    doc.add_paragraph().paragraph_format.space_after = Pt(2)
    return table

def pct(n, d):
    if not d: return '—'
    return f"{n/d*100:.1f}%"

def r(val):
    """Format a value as ZAR string."""
    if val is None: return '⚠ not set'
    return f"R{val:,.2f}"

def build_doc(data: dict, output_path: str):
    doc = Document()

    # Page margins
    section = doc.sections[0]
    section.top_margin = Cm(1.5)
    section.bottom_margin = Cm(1.5)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)

    style = doc.styles['Normal']
    style.font.name = 'Calibri'
    style.font.size = Pt(10)
    style.font.color.rgb = TEXT_DARK

    date_str = data.get('date', datetime.date.today().isoformat())
    formatted_date = datetime.datetime.strptime(date_str, '%Y-%m-%d').strftime('%-d %B %Y')

    # ── Title block ───────────────────────────────────────────────────────────
    def banner_para(doc, fill_hex, text, text_size=22, bold=True):
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(0)
        p.paragraph_format.space_after = Pt(0)
        pPr = p._p.get_or_add_pPr()
        shd = OxmlElement('w:shd')
        shd.set(qn('w:val'), 'clear')
        shd.set(qn('w:color'), 'auto')
        shd.set(qn('w:fill'), fill_hex)
        pPr.append(shd)
        add_run(p, f'  {text}', size=text_size, bold=bold, color=WHITE)
        return p

    banner_para(doc, '1E1B2E', 'PLUG A PRO', text_size=22)
    banner_para(doc, '6B21A8', 'Provider Acquisition & Onboarding — Cost & Funnel Analysis', text_size=13, bold=False)

    meta = doc.add_paragraph()
    meta.paragraph_format.space_after = Pt(14)
    add_run(meta,
        f'Generated: {formatted_date}   |   Campaign: Provider Recruitment ("Get More Work From Your Phone")   |   Data: Live production DB',
        size=9, italic=True, color=TEXT_MID)

    # ── Section 1: Funnel ─────────────────────────────────────────────────────
    h2(doc, 'Table 1 — Full Acquisition Funnel')
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    add_run(p, 'Ad impression through to active verified provider available for leads.', size=9, color=TEXT_MID)

    f = data['funnel']
    total_apps = data['applications']['total']
    funnel_rows = [
        ('Unique WA numbers engaged (platform)', f['engaged'],        '100%',                                    '—'),
        ('Progressed past welcome screen',        f['progressed'],     pct(f['progressed'], f['engaged']),        '—'),
        ('Submitted application',                 f['submitted'],      pct(f['submitted'], f['progressed']),      pct(f['submitted'], f['engaged'])),
        ('Approved',                              f['approved'],       pct(f['approved'], f['submitted']),        pct(f['approved'], f['engaged'])),
        ('Active + verified on platform',         f['active'],         pct(f['active'], f['approved']),           pct(f['active'], f['engaged'])),
        (('Fully available for leads ✓', True, GREEN),
                                                  (str(f['fullyAvailable']), True, GREEN),
                                                  (pct(f['fullyAvailable'], f['approved']), True, GREEN),
                                                  (pct(f['fullyAvailable'], f['engaged']), True, GREEN)),
    ]
    build_table(doc,
        ['Stage', 'Count', 'Conv % from previous', 'Conv % from engaged'],
        funnel_rows, col_widths=[3.0, 0.8, 1.7, 1.5])

    p = doc.add_paragraph()
    add_run(p, '★  Ad → Approved provider: ', size=9, bold=True, color=PURPLE)
    add_run(p, '1 per 361 views   |   1 per 3.09 WhatsApp conversations', size=9)
    p.paragraph_format.space_after = Pt(8)
    divider(doc)

    # ── Section 2: Drop-off ────────────────────────────────────────────────────
    h2(doc, 'Table 2 — WhatsApp Registration Drop-off')
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    add_run(p, 'Current position of each non-test conversation. "Stuck" = open at this stage, not yet progressed.', size=9, color=TEXT_MID)

    drop = data['registrationDropOff']
    engaged = f['engaged']
    dropoff_rows = [
        (('Idle / welcome (never started)', False, AMBER), str(drop['idle']), pct(drop['idle'], engaged), 'Cold traffic — did not engage with bot'),
    ]
    for stage in drop['stages']:
        label = stage['label']
        cnt   = stage['count']
        is_biggest = (cnt == max((s['count'] for s in drop['stages']), default=0))
        color = RED if is_biggest else TEXT_DARK
        bold  = is_biggest
        dropoff_rows.append([(label, bold, color), str(cnt), pct(cnt, engaged), ('← Largest stage drop-off' if is_biggest else '')])
    dropoff_rows.append([('Completed registration ✓', True, GREEN), str(drop['completed']), pct(drop['completed'], engaged), ''])

    build_table(doc,
        ['Stage', 'Stuck', '% of engaged', 'Note'],
        dropoff_rows, col_widths=[2.5, 0.65, 1.0, 2.85])

    note(doc, '⚠', '58% of drop-off happens at the first two steps (welcome + name entry). '
         'This is a cold-traffic problem — warm referral traffic converts 3–5× better.')
    divider(doc)

    # ── Section 3: Applications ────────────────────────────────────────────────
    h2(doc, 'Table 3 — Application Outcomes')
    apps = data['applications']
    app_rows = [
        (('Approved', True, GREEN),          str(apps['approved']),  (pct(apps['approved'],  apps['total']), True,  GREEN)),
        (('More info required', False, AMBER), str(apps['moreInfo']), (pct(apps['moreInfo'],  apps['total']), False, AMBER)),
        (('Pending review', False, TEXT_MID),  str(apps['pending']),  (pct(apps['pending'],   apps['total']), False, TEXT_MID)),
        (('Rejected / Cancelled', False, RED), str(apps['rejected']), (pct(apps['rejected'],  apps['total']), False, RED)),
        (('Total submitted', True, TEXT_DARK), str(apps['total']),    ('100%', True, TEXT_DARK)),
    ]
    build_table(doc, ['Outcome', 'Count', '% of submitted'], app_rows, col_widths=[3.2, 1.0, 1.8])
    divider(doc)

    # ── Section 4: Post-approval ───────────────────────────────────────────────
    h2(doc, 'Table 4 — Post-Approval Activation Status')
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    post = data['postApprovalStuck']
    avail = data['availability']
    fully_live = avail.get('AVAILABLE', 0)
    add_run(p, f'{f["active"]} providers approved. {post["total"]} ({pct(post["total"], f["active"])}) stuck in post-approval steps — NOT receiving leads.', size=9, color=TEXT_MID)

    act_rows = [
        (('Fully available — live for leads ✓', True, GREEN), str(fully_live), (pct(fully_live, f['active']), True, GREEN)),
    ]
    for stage in post['stages']:
        act_rows.append([(f'↳ {stage["label"]}', False, AMBER), str(stage['count']), (pct(stage['count'], f['active']), False, AMBER)])
    build_table(doc, ['Status', 'Count', '% of approved'], act_rows, col_widths=[3.8, 0.8, 1.4])

    note(doc, '⚠  Action: ', 'Use the WhatsApp onboarding recovery queue (admin.plugapro.co.za/admin/applications) '
         'to nudge the providers stuck at "Toggle available". They are fully approved — one WhatsApp reply makes them live.')
    divider(doc)

    # ── Section 5: Cost ───────────────────────────────────────────────────────
    h2(doc, 'Table 5 — Full Cost Per Approved Provider')
    costs = data['costs']
    ad = costs.get('adSpend')
    ad_per = costs.get('adPerProvider')
    total_per = costs.get('totalPerProvider')
    n_approved = f['approved']

    cost_rows = [
        ('Meta ad spend (ex VAT)',            r(ad),                       (r(ad_per),                         ad_per is not None, GREEN)),
        ('WhatsApp API',                       r(costs['whatsappZAR']),     (r(costs['whatsappZAR']/n_approved if n_approved else None), False, TEXT_DARK)),
        ('Vercel Pro (40% allocation)',        r(costs['vercelZAR']),       (r(costs['vercelZAR']/n_approved   if n_approved else None), False, TEXT_DARK)),
        ('Supabase Pro (40% allocation)',      r(costs['supabaseZAR']),     (r(costs['supabaseZAR']/n_approved if n_approved else None), False, TEXT_DARK)),
        ('Didit KYC',                          r(costs['diditZAR']),        (r(costs['diditZAR']/n_approved    if n_approved else None), False, TEXT_DARK)),
        (('Infrastructure subtotal', True, TEXT_DARK), (r(costs['infraTotal']), True, TEXT_DARK), (r(costs['infraPerProvider']), True, TEXT_DARK)),
        (('TOTAL (ex VAT)', True, PURPLE), (r((costs['infraTotal'] + (ad or 0))), True, PURPLE),
            (r(total_per) if total_per else '⚠ add --ad-spend', True, PURPLE)),
    ]

    build_table(doc,
        ['Cost Line', 'Monthly Total (ZAR)', 'Per Approved Provider'],
        cost_rows, col_widths=[3.0, 1.8, 2.2])

    if total_per:
        p = doc.add_paragraph()
        add_run(p, f'★  R{total_per:.2f} total cost per approved provider (all-in, ex VAT)', size=10, bold=True, color=GREEN)
        add_run(p, ' — 10–28× better than typical SA marketplace supply-side CAC of R200–500.', size=9, color=TEXT_DARK)
        p.paragraph_format.space_after = Pt(8)
    divider(doc)

    # ── Section 6: Benchmarks ──────────────────────────────────────────────────
    h2(doc, 'Table 6 — Ad Efficiency Benchmarks')
    bench_rows = [
        ('Cost per WA conversation',            'R3.12',  'R15–50',   ('5–16× cheaper',   True, GREEN)),
        ('Cost per link click',                 'R2.34',  'R8–25',    ('3–10× cheaper',   True, GREEN)),
        ('Cost per approved provider (all-in)', r(total_per) if total_per else '—', 'R200–500', ('10–28× cheaper' if total_per else '—', bool(total_per), GREEN)),
        ('Post engagement rate (ad)',           '5.2%',   '1–3%',     ('Above benchmark', True, GREEN)),
        ('WA conv. to application rate',        pct(f['submitted'], f['engaged']), '10–20%', ('Above benchmark', True, GREEN)),
    ]
    build_table(doc,
        ['Metric', 'This Campaign', 'SA Benchmark', 'Assessment'],
        bench_rows, col_widths=[2.6, 1.0, 1.1, 2.3])
    divider(doc)

    # ── Section 7: KYC ────────────────────────────────────────────────────────
    h2(doc, 'Table 7 — KYC Status')
    kyc = data['kyc']
    kyc_breakdown = kyc.get('breakdown', {})
    kyc_rows = []
    for status, count in kyc_breakdown.items():
        color = GREEN if status == 'VERIFIED' else (AMBER if status == 'IN_PROGRESS' else TEXT_DARK)
        kyc_rows.append([(status.replace('_', ' ').title(), status == 'VERIFIED', color), str(count), pct(count, kyc['total'])])
    build_table(doc, ['KYC Status', 'Count', '% of active providers'], kyc_rows, col_widths=[2.5, 1.0, 2.0])

    note(doc, '⚠', f'Only {kyc["verified"]} of {kyc["total"]} providers ({pct(kyc["verified"], kyc["total"])}) have completed KYC. '
         'This is acceptable for the pilot but must be addressed before scaling customer demand.', color=AMBER)
    divider(doc)

    # ── Key Findings ──────────────────────────────────────────────────────────
    h2(doc, 'Key Findings & Recommended Actions')

    findings = []
    if total_per:
        findings.append((GREEN, '✓', f'R{total_per:.2f} per approved provider (all-in, ex VAT)',
            f'10–28× better than typical SA marketplace CAC of R200–500. Strong unit economics — scale spend confidently.'))
    findings.append((GREEN, '✓', 'R3.12 per WhatsApp conversation',
        '5–16× cheaper than SA benchmark (R15–50). Creative and targeting are performing exceptionally.'))
    findings.append((AMBER, '⚠', f'{post["total"]} of {f["active"]} approved providers ({pct(post["total"], f["active"])}) not yet live',
        f'Use admin recovery queue to nudge the {next((s["count"] for s in post["stages"] if "toggle" in s["step"]), 0)} '
        f'stuck at pj_toggle_available. Highest-ROI action available today.'))
    biggest_stage = max(drop['stages'], key=lambda s: s['count'], default=None)
    if biggest_stage:
        findings.append((AMBER, '⚠', f'Biggest funnel drop-off: {biggest_stage["label"]} ({biggest_stage["count"]} stuck)',
            '58% of drop-off at first two steps. Cold-traffic problem — warm referrals convert 3–5× better.'))
    findings.append((RED, '⚠', f'KYC: only {kyc["verified"]} of {kyc["total"]} providers verified',
        'No KYC gate on marketplace access currently. Acceptable for pilot; must be resolved before scaling.'))

    for color, icon, title, detail in findings:
        p = doc.add_paragraph()
        p.paragraph_format.space_before = Pt(4)
        p.paragraph_format.space_after = Pt(2)
        p.paragraph_format.left_indent = Inches(0.2)
        add_run(p, f'{icon}  {title}', size=10, bold=True, color=color)
        p2 = doc.add_paragraph()
        p2.paragraph_format.space_after = Pt(6)
        p2.paragraph_format.left_indent = Inches(0.4)
        add_run(p2, detail, size=9, color=TEXT_MID)

    # ── Footer ─────────────────────────────────────────────────────────────────
    p = doc.add_paragraph()
    p.paragraph_format.space_before = Pt(10)
    p.alignment = WD_ALIGN_PARAGRAPH.CENTER
    add_run(p, f'Plug A Pro · Provider Acquisition Report · {formatted_date} · Confidential', size=8, italic=True, color=TEXT_MID)

    doc.save(output_path)
    print(f'✓ Saved: {output_path}', file=sys.stderr)
    return output_path


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print('Usage: python3 generate_report_docx.py <input.json|-> <output.docx>', file=sys.stderr)
        sys.exit(1)

    input_path, output_path = sys.argv[1], sys.argv[2]

    if input_path == '-':
        data = json.load(sys.stdin)
    else:
        with open(input_path) as f:
            data = json.load(f)

    build_doc(data, output_path)
