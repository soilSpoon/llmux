#!/usr/bin/env python3
"""
SSE 스트림 변환 분석 도구

a.txt (원본 Business SSE 응답)와 b.txt (변환된 SSE 응답)를 비교하여
누락되거나 변경되는 정보를 분석합니다.
"""

import json
import re
from typing import Optional
from collections import defaultdict


def parse_sse_file(file_path: str) -> list[dict]:
    """SSE 파일을 파싱하여 이벤트 리스트로 변환"""
    events = []
    current_event = None
    current_data_lines = []
    
    with open(file_path, 'r', encoding='utf-8') as f:
        content = f.read()
    
    lines = content.split('\n')
    i = 0
    while i < len(lines):
        line = lines[i]
        
        if line.startswith('event:'):
            # 이전 이벤트 저장
            if current_event and current_data_lines:
                data_str = '\n'.join(current_data_lines).strip()
                if data_str:
                    try:
                        events.append({
                            'event': current_event,
                            'data': json.loads(data_str)
                        })
                    except json.JSONDecodeError:
                        events.append({
                            'event': current_event,
                            'data_raw': data_str
                        })
            
            current_event = line.split(':', 1)[1].strip()
            current_data_lines = []
        elif line.startswith('data:'):
            rest = line[5:].strip()
            current_data_lines = [rest] if rest else []
        elif current_data_lines is not None and line.strip():
            current_data_lines.append(line)
        
        i += 1
    
    # 마지막 이벤트 저장
    if current_event and current_data_lines:
        data_str = '\n'.join(current_data_lines).strip()
        if data_str:
            try:
                events.append({
                    'event': current_event,
                    'data': json.loads(data_str)
                })
            except json.JSONDecodeError:
                events.append({
                    'event': current_event,
                    'data_raw': data_str
                })
    
    return events


def get_all_keys(obj: dict, prefix: str = '') -> set[str]:
    """재귀적으로 모든 키 경로 수집"""
    keys = set()
    for k, v in obj.items():
        full_path = f"{prefix}.{k}" if prefix else k
        keys.add(full_path)
        if isinstance(v, dict):
            keys.update(get_all_keys(v, full_path))
        elif isinstance(v, list) and v and isinstance(v[0], dict):
            keys.update(get_all_keys(v[0], f"{full_path}[0]"))
    return keys


def analyze_response_object(a_resp: dict, b_resp: dict, context: str) -> list[str]:
    """response 객체의 필드 비교"""
    issues = []
    
    # a에 있지만 b에 없는 필드
    a_keys = set(a_resp.keys())
    b_keys = set(b_resp.keys())
    
    missing_in_b = a_keys - b_keys
    if missing_in_b:
        for key in sorted(missing_in_b):
            value = a_resp[key]
            if value is not None and value != [] and value != {}:
                value_preview = str(value)[:100] + '...' if len(str(value)) > 100 else str(value)
                issues.append(f"  - **누락**: `{key}` = {value_preview}")
            else:
                issues.append(f"  - **누락 (null/empty)**: `{key}` = {value}")
    
    # 값이 다른 필드
    common_keys = a_keys & b_keys
    for key in sorted(common_keys):
        if a_resp[key] != b_resp[key]:
            # 중첩 객체는 깊이 비교
            if isinstance(a_resp[key], dict) and isinstance(b_resp[key], dict):
                nested_issues = analyze_response_object(a_resp[key], b_resp[key], f"{context}.{key}")
                if nested_issues:
                    issues.extend([f"  - **중첩 차이 ({key})**: " + issue.strip() for issue in nested_issues])
            else:
                a_val = str(a_resp[key])[:50]
                b_val = str(b_resp[key])[:50]
                issues.append(f"  - **값 다름**: `{key}`: a=`{a_val}` → b=`{b_val}`")
    
    return issues


def analyze_item_fields(a_item: dict, b_item: dict, context: str) -> list[str]:
    """item 객체 비교"""
    issues = []
    
    a_keys = set(a_item.keys())
    b_keys = set(b_item.keys())
    
    missing_in_b = a_keys - b_keys
    if missing_in_b:
        for key in sorted(missing_in_b):
            value = a_item[key]
            value_preview = str(value)[:80] + '...' if len(str(value)) > 80 else str(value)
            issues.append(f"  - **item 필드 누락**: `{key}` = {value_preview}")
    
    return issues


def main():
    print("=" * 80)
    print("SSE 스트림 변환 분석 보고서")
    print("=" * 80)
    print()
    
    a_events = parse_sse_file('a.txt')
    b_events = parse_sse_file('b.txt')
    
    print(f"## 파일 개요")
    print(f"- **a.txt** (원본): {len(a_events)} 이벤트")
    print(f"- **b.txt** (변환): {len(b_events)} 이벤트")
    print()
    
    # 이벤트 타입별 분류
    a_by_type = defaultdict(list)
    b_by_type = defaultdict(list)
    
    for e in a_events:
        a_by_type[e['event']].append(e)
    for e in b_events:
        b_by_type[e['event']].append(e)
    
    print(f"## 이벤트 타입별 개수 비교")
    print()
    print("| 이벤트 타입 | a.txt | b.txt | 차이 |")
    print("|------------|-------|-------|------|")
    
    all_event_types = sorted(set(a_by_type.keys()) | set(b_by_type.keys()))
    for event_type in all_event_types:
        a_count = len(a_by_type.get(event_type, []))
        b_count = len(b_by_type.get(event_type, []))
        diff = b_count - a_count
        diff_str = f"+{diff}" if diff > 0 else str(diff) if diff != 0 else ""
        print(f"| {event_type} | {a_count} | {b_count} | {diff_str} |")
    
    print()
    
    # 누락된 이벤트 타입
    missing_event_types = set(a_by_type.keys()) - set(b_by_type.keys())
    if missing_event_types:
        print("## 변환 후 누락된 이벤트 타입")
        print()
        for event_type in sorted(missing_event_types):
            print(f"- `{event_type}` ({len(a_by_type[event_type])}개 이벤트)")
        print()
    
    # response.created 이벤트 비교
    print("## `response.created` 이벤트 상세 비교")
    print()
    
    if a_by_type['response.created'] and b_by_type['response.created']:
        a_created = a_by_type['response.created'][0]['data']
        b_created = b_by_type['response.created'][0]['data']
        
        if 'response' in a_created and 'response' in b_created:
            a_resp = a_created['response']
            b_resp = b_created['response']
            
            issues = analyze_response_object(a_resp, b_resp, 'response.created.response')
            
            if issues:
                print("### response 객체에서 발견된 차이점:")
                print()
                for issue in issues:
                    print(issue)
                print()
            else:
                print("response 객체가 동일합니다.")
                print()
    
    # response.in_progress 이벤트 비교
    print("## `response.in_progress` 이벤트 상세 비교")
    print()
    
    if a_by_type['response.in_progress'] and b_by_type['response.in_progress']:
        a_in_progress = a_by_type['response.in_progress'][0]['data']
        b_in_progress = b_by_type['response.in_progress'][0]['data']
        
        if 'response' in a_in_progress and 'response' in b_in_progress:
            a_resp = a_in_progress['response']
            b_resp = b_in_progress['response']
            
            issues = analyze_response_object(a_resp, b_resp, 'response.in_progress.response')
            
            if issues:
                print("### response 객체에서 발견된 차이점:")
                print()
                for issue in issues:
                    print(issue)
                print()
            else:
                print("response 객체가 동일합니다.")
                print()
    
    # response.output_item.added 비교
    print("## `response.output_item.added` 이벤트 상세 비교")
    print()
    
    if a_by_type['response.output_item.added'] and b_by_type['response.output_item.added']:
        a_added = a_by_type['response.output_item.added'][0]['data']
        b_added = b_by_type['response.output_item.added'][0]['data']
        
        # 전체 구조 비교
        a_keys = set(a_added.keys())
        b_keys = set(b_added.keys())
        
        missing = a_keys - b_keys
        extra = b_keys - a_keys
        
        if missing:
            print(f"### 누락된 최상위 필드: {sorted(missing)}")
            print()
        if extra:
            print(f"### 추가된 최상위 필드: {sorted(extra)}")
            print()
        
        # item 객체 비교
        if 'item' in a_added and 'item' in b_added:
            a_item = a_added['item']
            b_item = b_added['item']
            
            issues = analyze_item_fields(a_item, b_item, 'response.output_item.added.item')
            if issues:
                print("### item 객체 차이점:")
                print()
                for issue in issues:
                    print(issue)
                print()
    
    # 주요 누락 필드 요약
    print("=" * 80)
    print("## 핵심 요약: 변환 시 누락되는 주요 정보")
    print("=" * 80)
    print()
    
    if a_by_type['response.created']:
        a_resp = a_by_type['response.created'][0]['data'].get('response', {})
        critical_fields = [
            'instructions', 'background', 'completed_at', 'error', 
            'incomplete_details', 'max_output_tokens', 'max_tool_calls',
            'parallel_tool_calls', 'previous_response_id', 'prompt_cache_key',
            'prompt_cache_retention', 'reasoning', 'safety_identifier',
            'service_tier', 'store', 'temperature', 'text', 'tool_choice',
            'tools', 'top_logprobs', 'top_p', 'truncation', 'usage', 'user', 'metadata',
            'output'
        ]
        
        print("### `response.created` / `response.in_progress`에서 누락되는 필드:")
        print()
        
        if b_by_type['response.created']:
            b_resp = b_by_type['response.created'][0]['data'].get('response', {})
            for field in critical_fields:
                if field in a_resp and field not in b_resp:
                    value = a_resp[field]
                    if value is not None:
                        if isinstance(value, str) and len(value) > 100:
                            value_preview = f"[{len(value)} chars]"
                        elif isinstance(value, list):
                            value_preview = f"[{len(value)} items]"
                        else:
                            value_preview = str(value)[:80]
                        print(f"- `{field}`: {value_preview}")
                # output 필드가 존재하지만 빈 배열인 경우도 체크
                elif field == 'output' and field in a_resp and field in b_resp:
                    if a_resp[field] != b_resp[field]:
                        print(f"- `{field}`: a={a_resp[field]} vs b={b_resp[field]}")
        print()
    
    # reasoning 이벤트 분석
    if 'response.reasoning_summary_part.added' in a_by_type:
        print("### reasoning 관련 이벤트 (a.txt에만 존재):")
        print()
        for event_type in all_event_types:
            if 'reasoning' in event_type:
                count = len(a_by_type.get(event_type, []))
                if count > 0:
                    print(f"- `{event_type}`: {count}개")
        print()
    
    # output_item.added에서 누락되는 필드
    if a_by_type['response.output_item.added'] and b_by_type['response.output_item.added']:
        print("### `response.output_item.added.item`에서 누락되는 필드:")
        print()
        
        a_item = a_by_type['response.output_item.added'][0]['data'].get('item', {})
        b_item = b_by_type['response.output_item.added'][0]['data'].get('item', {})
        
        missing_item_fields = set(a_item.keys()) - set(b_item.keys())
        for field in sorted(missing_item_fields):
            print(f"- `{field}`: {a_item[field]}")
        print()
    
    # content_part.added 비교
    if a_by_type['response.content_part.added'] and b_by_type['response.content_part.added']:
        print("### `response.content_part.added.part`에서 누락되는 필드:")
        print()
        
        a_part = a_by_type['response.content_part.added'][0]['data'].get('part', {})
        b_part = b_by_type['response.content_part.added'][0]['data'].get('part', {})
        
        missing_part_fields = set(a_part.keys()) - set(b_part.keys())
        for field in sorted(missing_part_fields):
            value = a_part[field]
            value_preview = str(value)[:50] if value else str(value)
            print(f"- `{field}`: {value_preview}")
        print()
    
    # output_text.delta 비교
    if a_by_type['response.output_text.delta'] and b_by_type['response.output_text.delta']:
        print("### `response.output_text.delta`에서 누락되는 필드:")
        print()
        
        a_delta = a_by_type['response.output_text.delta'][0]['data']
        b_delta = b_by_type['response.output_text.delta'][0]['data']
        
        missing_delta_fields = set(a_delta.keys()) - set(b_delta.keys())
        for field in sorted(missing_delta_fields):
            value = a_delta[field]
            value_preview = str(value)[:50] if value else str(value)
            print(f"- `{field}`: {value_preview}")
        print()
    
    print("=" * 80)
    print("## 권장 조치 사항")
    print("=" * 80)
    print()
    print("1. **response 객체 확장**: `response.created`, `response.in_progress` 이벤트의")
    print("   response 객체를 원본과 동일하게 모든 필드를 포함하도록 수정")
    print()
    print("2. **reasoning 이벤트 처리**: `response.reasoning_summary_*` 이벤트들을")
    print("   변환 로직에 추가하여 passthrough 또는 변환 처리")
    print()
    print("3. **item 객체 확장**: `response.output_item.added`의 item 객체에서")
    print("   `summary`, `status`, `content`, `role` 등 누락된 필드 추가")
    print()
    print("4. **part 객체 확장**: `response.content_part.added`의 part 객체에서")
    print("   `annotations`, `logprobs` 필드 추가")
    print()
    print("5. **delta 객체 확장**: `response.output_text.delta`에서")
    print("   `logprobs`, `obfuscation`, `sequence_number` 필드 추가")
    print()


if __name__ == '__main__':
    main()
