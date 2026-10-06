"""Sources: only the files an answer used, with quotes that are really in them."""

from __future__ import annotations

from byos_api.ai import citations

JUN = "11111111-1111-1111-1111-111111111111"
MAY = "22222222-2222-2222-2222-222222222222"
NAMES = {JUN: "Payslip_Jun.pdf", MAY: "Payslip_May.pdf"}
TEXTS = {
    JUN: "Pay Period June 2026 ... ₹84,500.00 Total Net Pay ... Stipend ₹30,000.00",
    MAY: "Pay Period May 2026 ... ₹90,000.00 Total Net Pay ... Stipend ₹30,000.00",
}
ANSWER = "Your net pay for June 2026 was ₹84,500.00."


def test_citation_lines_are_stripped():
    raw = f"{ANSWER}\n\n[source: {JUN} | Total Net Pay]"
    clean, cites = citations.split(raw)
    assert clean == ANSWER
    assert cites == [(JUN, "Total Net Pay")]


def test_only_cited_files_are_kept_with_verified_quotes():
    cites = [(JUN, "₹84,500.00 Total Net Pay")]
    out = citations.pick(ANSWER, cites, TEXTS, NAMES, [JUN, MAY])
    assert out == [{"id": JUN, "name": "Payslip_Jun.pdf", "quotes": ["₹84,500.00 Total Net Pay"]}]


def test_a_paraphrased_quote_falls_back_to_its_figures():
    cites = [(JUN, "net pay of ₹84,500.00 for June")]
    out = citations.pick(ANSWER, cites, TEXTS, NAMES, [JUN, MAY])
    assert out[0]["quotes"] == ["84,500.00"]


def test_made_up_ids_are_ignored():
    cites = [("33333333-3333-3333-3333-333333333333", "x")]
    out = citations.pick(ANSWER, cites, TEXTS, NAMES, [JUN, MAY])
    assert [s["id"] for s in out] == [JUN]  # falls back to matching the figures


def test_without_citations_files_are_picked_by_the_answers_figures():
    out = citations.pick(ANSWER, [], TEXTS, NAMES, [MAY, JUN])
    assert [s["id"] for s in out] == [JUN]
    assert out[0]["quotes"] == ["84,500.00"]  # the year helped pick it, isn't marked


def test_figures_from_no_file_mean_no_sources():
    out = citations.pick("It was ₹1,23,456.", [], TEXTS, NAMES, [JUN, MAY])
    assert out == []
