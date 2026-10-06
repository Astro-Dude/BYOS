"""/organize: settings become instructions, and what's off is withheld."""

from __future__ import annotations

import asyncio
import uuid

from byos_api.ai import organize, tools
from byos_api.ai.schemas import OrganizeOptions
from byos_api.db.models import File, Folder, User


def _offered(opts: OrganizeOptions) -> set[str]:
    return {t["function"]["name"] for t in tools.schemas(exclude=organize.excluded_tools(opts))}


def test_by_default_it_cannot_rename_tag_delete_or_share():
    offered = _offered(OrganizeOptions())
    assert {"create_folder", "move_file", "list_files", "read_file_text"} <= offered
    assert not offered & {
        "rename_file",
        "rename_folder",
        "move_folder",
        "add_tag",
        "delete_file",
        "delete_folder",
        "create_share_link",
        "create_alias",
    }


def test_settings_turn_tools_on():
    offered = _offered(OrganizeOptions(rename=True, tags=True, keep_existing=False))
    assert {"rename_file", "add_tag", "rename_folder", "move_folder"} <= offered
    assert "delete_folder" not in offered  # never, whatever the settings


def test_names_only_withholds_reading():
    offered = _offered(OrganizeOptions(read_contents=False))
    assert "read_file_text" not in offered and "search_content" not in offered


def test_the_brief_states_each_setting():
    text = organize.brief(OrganizeOptions(group_by="year", depth=1))
    assert "Do not rename any file" in text
    assert "the year they belong to" in text
    assert "at most 1 level deep" in text
    assert "Never delete or share anything" in text


def test_depth_can_be_left_to_the_agent():
    assert OrganizeOptions().group_by == "topic" and OrganizeOptions().depth is None
    text = organize.brief(OrganizeOptions(depth=None))
    assert "as deep as suits the files" in text and "Never more than 3 levels" in text


# ── plain-language requests ────────────────────────────────────────────────


def test_plain_requests_to_organize_are_recognised():
    for text in [
        "organise my files",
        "Can you tidy up my downloads?",
        "sort my documents by year",
        "please restructure the drive, and rename the scans",
    ]:
        assert organize.looks_like_organizing(text) is not None, text
    renaming = organize.looks_like_organizing("restructure the drive and rename the scans")
    assert renaming is not None and renaming.rename and not renaming.tags
    plain = organize.looks_like_organizing("tidy my files")
    assert plain is not None and plain.rename is False and plain.depth is None


def test_questions_are_not_organizing():
    for text in [
        "what's my salary in june?",
        "list files sorted by size",
        "how many pdfs do I have",
        "summarise the rental agreement",
    ]:
        assert organize.looks_like_organizing(text) is None, text


# ── preview ────────────────────────────────────────────────────────────────


class _Rows:
    def __init__(self, rows):
        self._rows = rows

    def scalars(self):
        return iter(self._rows)


class _FakeDb:
    """Answers preview's two selects (folders, then files) from memory."""

    def __init__(self, folders, files, loose=()):
        self.folders, self.files, self.loose = folders, files, list(loose)

    async def execute(self, stmt):
        first = stmt.column_descriptions[0]
        if first["entity"] is Folder:
            return _Rows(self.folders)
        if first["name"] == "name":  # loose files: names at the root
            return _Rows([f.name for f in self.loose])
        return _Rows(self.files)


def test_preview_draws_the_drive_after_the_plan():
    owner = uuid.uuid4()
    inbox = Folder(id=uuid.uuid4(), owner_id=owner, parent_id=None, name="Inbox")
    old = Folder(id=uuid.uuid4(), owner_id=owner, parent_id=None, name="Misc")
    slip = File(id=uuid.uuid4(), owner_id=owner, folder_id=inbox.id, name="slip_jun.pdf")
    scan = File(id=uuid.uuid4(), owner_id=owner, folder_id=None, name="scan_01.jpg")
    actions = [
        {"op": "create_folder", "args": {"name": "Finance", "parent_id": None}},
        {"op": "create_folder", "args": {"name": "Payslips", "parent_id": "$new:0"}},
        {"op": "move_file", "args": {"file_id": str(slip.id), "folder_id": "$new:1"}},
        {"op": "rename_file", "args": {"file_id": str(scan.id), "name": "Passport.jpg"}},
        {"op": "rename_folder", "args": {"folder_id": str(old.id), "name": "Archive"}},
        {"op": "add_tag", "args": {"file_id": str(slip.id), "name": "Payslip"}},
        {"op": "set_favorite", "args": {"file_id": str(slip.id), "favorite": True}},
        {"op": "remove_tag", "args": {"file_id": str(scan.id), "name": "old"}},
    ]
    user = User(id=owner, username="t")
    pan = File(id=uuid.uuid4(), owner_id=owner, folder_id=None, name="PAN_card.jpg")
    db = _FakeDb([inbox, old], [slip, scan], loose=[pan])
    tree = asyncio.run(organize.preview(db, user, actions))  # type: ignore[arg-type]

    assert tree is not None
    assert (tree["new_folders"], tree["moved"], tree["renamed"]) == (2, 1, 1)
    assert (tree["tagged"], tree["starred"]) == (2, 1)
    root = tree["root"]
    finance = root["children"][0]
    assert finance["name"] == "Finance" and finance["new"]
    payslips = finance["children"][0]
    assert payslips["name"] == "Payslips"
    slip_row = payslips["files"][0]
    assert (slip_row["name"], slip_row["from"], slip_row["tags_added"]) == (
        "slip_jun.pdf",
        "/Inbox",
        ["payslip"],
    )
    assert slip_row["star"] is True
    scan_row = root["files"][0]
    assert (scan_row["name"], scan_row["was"], scan_row["tags_removed"]) == (
        "Passport.jpg",
        "scan_01.jpg",
        ["old"],
    )
    archive = next(c for c in root["children"] if c["name"] == "Archive")
    assert archive["was"] == "Misc"
    # A loose file the plan doesn't place is called out, not silently dropped.
    assert tree["untouched"] == ["PAN_card.jpg"]
    # Inbox only lost a file: nothing drawn for it.
    assert all(c["name"] != "Inbox" for c in root["children"])


def test_no_preview_for_plans_with_nothing_to_draw():
    actions = [{"op": "create_share_link", "args": {"file_id": str(uuid.uuid4())}}]
    user = User(id=uuid.uuid4(), username="t")
    assert asyncio.run(organize.preview(_FakeDb([], []), user, actions)) is None  # type: ignore[arg-type]


def test_the_brief_lists_every_file_and_asks_for_all_of_them():
    drive = "Files (id | name | folder | type):\n- 1 | PAN_card.jpg | / | image/jpeg"
    text = organize.brief(OrganizeOptions(), drive)
    assert "PAN_card.jpg" in text
    assert "Account for EVERY file" in text
    assert "read it with read_file_text first" in text


def test_renaming_asks_for_one_pattern_per_kind_of_file():
    text = organize.brief(OrganizeOptions(rename=True))
    assert "ONE naming pattern" in text
    assert "even one whose current name is already clear" in text
    assert "ONE naming pattern" not in organize.brief(OrganizeOptions())  # renaming off


def test_a_revision_starts_from_the_previous_plan():
    fid = str(uuid.uuid4())
    text = organize.previous_plan(
        [
            {
                "op": "create_folder",
                "args": {"name": "Identity", "parent_id": None},
                "label": "Create folder “Identity”",
            },
            {
                "op": "move_file",
                "args": {"file_id": fid, "folder_id": "$new:0"},
                "label": "Move PAN.pdf → the new folder",
            },
        ]
    )
    assert "0. create_folder(name=Identity, parent_id=None)" in text
    assert f"file_id={fid}" in text and "folder_id=$new:0" in text
    assert "Don't re-read files" in text
    assert organize.previous_plan([]) == ""


def test_dropping_a_new_folder_drops_what_goes_in_it_and_renumbers():
    from byos_api.ai.agent import _without

    actions = [
        {"op": "create_folder", "args": {"name": "Tax", "parent_id": None}},  # 0, dropped
        {"op": "move_file", "args": {"file_id": "a", "folder_id": "$new:0"}},  # 1, goes with 0
        {"op": "create_folder", "args": {"name": "Identity", "parent_id": None}},  # 2 → 0
        {"op": "move_file", "args": {"file_id": "b", "folder_id": "$new:2"}},  # 3 → 1
        {"op": "move_file", "args": {"file_id": "c", "folder_id": "$new:2"}},  # 4, dropped
    ]
    kept, results = _without(actions, [None] * 5, {0, 4})
    assert [a["args"].get("name") or a["args"]["file_id"] for a in kept] == ["Identity", "b"]
    assert kept[1]["args"]["folder_id"] == "$new:0"
    assert results == [None, None]


def test_revision_brief_says_the_old_changes_are_already_in():
    text = organize.previous_plan(
        [{"op": "move_file", "args": {"file_id": "x"}, "label": "Move x"}]
    )
    assert "ALREADY in this plan" in text and "Do NOT propose these again" in text
    assert "from 1 up, so don't guess one" in text


def test_failed_changes_are_redone_against_the_real_folders():
    made_id = uuid.uuid4()
    actions = [
        {"op": "create_folder", "args": {"name": "Payslips", "parent_id": None}},
        {"op": "move_file", "args": {"file_id": "a", "folder_id": "$new:0"}},
        {"op": "move_file", "args": {"file_id": "b", "folder_id": "$new:1"}},  # miscount
    ]
    fixed = organize.with_real_folders(actions[1]["args"], actions, {0: made_id})
    assert fixed == {"file_id": "a", "folder_id": str(made_id)}
    # A ref to a move (not a folder) can't be resolved: left for the agent to work out.
    assert (
        organize.with_real_folders(actions[2]["args"], actions, {0: made_id}) == actions[2]["args"]
    )
    text = organize.fix_brief([(actions[2], "refers to a folder that wasn't created")])
    assert "refers to a folder that wasn't created" in text and "real folder ids" in text
    limits = organize.fix_settings([actions[1], {"op": "rename_file", "args": {}}])
    assert limits.rename and not limits.tags
