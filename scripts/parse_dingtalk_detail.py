#!/usr/bin/env python3
"""
Parse DingTalk OA approval detail from dws api raw output.
Fetches form_component_values that are lost during saNode parse errors.

Requires: dws auth login with app credentials (AppKey + AppSecret)
App needs qyapi_aflow permission.

Usage as filter:
    dws api POST "/topapi/processinstance/get" \\
      --base-url "https://oapi.dingtalk.com" \\
      --data '{"process_instance_id":"<id>"}' \\
      --format json | python3 parse_dingtalk_detail.py

Usage with instance_id (calls dws api internally):
    python3 parse_dingtalk_detail.py <instance_id>
"""

import sys
import json
import subprocess
from typing import Any


def fetch_detail(instance_id: str) -> dict[str, Any]:
    """Fetch raw approval detail via dws api (oapi endpoint)."""
    result = subprocess.run(
        [
            "dws", "api", "POST", "/topapi/processinstance/get",
            "--base-url", "https://oapi.dingtalk.com",
            "--data", json.dumps({"process_instance_id": instance_id}),
            "--format", "json",
        ],
        capture_output=True, text=True, timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"dws api failed: {result.stderr.strip()}")
    data = json.loads(result.stdout)
    if data.get("errcode") != 0:
        raise RuntimeError(
            f"API error {data.get('errcode')}: {data.get('errmsg', 'unknown')}"
        )
    return data


def format_items(detail_json: str) -> str:
    """Parse a 明细 (line-item detail) JSON array into formatted text."""
    rows = json.loads(detail_json)
    lines: list[str] = []
    for row in rows:
        items = {c["label"]: c["value"] for c in row["rowValue"] if c.get("value")}
        name = items.get("物品名称", "?")
        price = items.get("单价(元)", "?")
        qty = items.get("数量", "?")
        try:
            subtotal = float(str(price)) * float(str(qty))
        except (ValueError, TypeError):
            subtotal = 0
        usage = items.get("用途", "")
        budget = items.get("费用归属", "")
        channel = items.get("采购渠道", "")
        if isinstance(channel, list):
            channel = ", ".join(channel)
        addr = items.get("是否寄到公司", "")
        lines.append(
            f"  · {name} | ¥{price} ×{qty} = ¥{subtotal:.2f}"
        )
        if usage:
            lines.append(f"    用途: {usage}")
        if budget:
            lines.append(f"    费用归属: {budget}")
        if channel:
            lines.append(f"    采购渠道: {channel}")
        if addr:
            lines.append(f"    寄送: {addr}")
    return "\n".join(lines)


def format_form_values(pi: dict[str, Any]) -> list[str]:
    """Extract and format form_component_values from process_instance."""
    lines: list[str] = []
    lines.append("--- 表单内容 ---")
    for fv in pi.get("form_component_values", []):
        name = fv.get("name", "")
        value = fv.get("value", "")

        if name in ("是否采购手机",):
            lines.append(f"{name}: {value}")
        elif name == "总金额（元）":
            lines.append(f"总金额: ¥{value}")
        elif name == "明细" and value:
            lines.append("采购明细:")
            lines.append(format_items(value))
        elif name == "附件" and value and value != "null":
            lines.append("附件:")
            for att in json.loads(value):
                fname = att.get("fileName", "?")
                fsize = att.get("fileSize", 0)
                lines.append(f"  - {fname} ({fsize}B)")
        elif value and str(value) != "null":
            lines.append(f"{name}: {value}")
    return lines


def format_operation_records(pi: dict[str, Any]) -> list[str]:
    """Format approval operation records."""
    lines: list[str] = []
    lines.append("--- 审批流程 ---")
    for rec in pi.get("operation_records", []):
        result = rec.get("operation_result", "")
        show_name = rec.get("show_name", rec.get("operation_type", "?"))
        remark = rec.get("remark", "")
        mark = "✓" if result == "AGREE" else ("✗" if result == "REFUSE" else "·")
        line = f"  {mark} {show_name}"
        if remark:
            line += f" ({remark})"
        lines.append(line)
    return lines


def parse_detail(data: dict[str, Any]) -> str:
    """Parse a full approval detail response into human-readable text."""
    pi = data.get("process_instance", data)
    if not pi:
        return "(empty response)"

    parts = [
        f"标题: {pi.get('title', '?')}",
        f"状态: {pi.get('status', '?')}  结果: {pi.get('result', '?')}",
        f"编号: {pi.get('business_id', '?')}",
        f"发起时间: {pi.get('create_time', '?')}",
        f"部门: {pi.get('originator_dept_name', '?')}",
    ]

    form_lines = format_form_values(pi)
    if form_lines:
        parts.append("")
        parts.extend(form_lines)

    rec_lines = format_operation_records(pi)
    if rec_lines:
        parts.append("")
        parts.extend(rec_lines)

    return "\n".join(parts)


def main() -> None:
    if len(sys.argv) > 1:
        instance_id = sys.argv[1]
        data = fetch_detail(instance_id)
    else:
        data = json.load(sys.stdin)
    print(parse_detail(data))


if __name__ == "__main__":
    main()
