#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
金融分析 Agent 架构文档 PDF 生成脚本
"""

import os
import sys

# ── PDF Skill 路径设置 ────────────────────────────────────
PDF_SKILL_DIR = os.path.expanduser("~/.openclaw/workspace/skills/pdf")
_scripts = os.path.join(PDF_SKILL_DIR, "scripts")
if _scripts not in sys.path:
    sys.path.insert(0, _scripts)

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import inch, cm, mm
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.lib import colors
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, Image, CondPageBreak
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase.pdfmetrics import registerFontFamily

# ── 注册字体 ──────────────────────────────────────────────
pdfmetrics.registerFont(TTFont('NotoSerifSC', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('NotoSerifSCBold', '/usr/share/fonts/truetype/noto-serif-sc/NotoSerifSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('SarasaMono', '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Regular.ttf'))
pdfmetrics.registerFont(TTFont('SarasaMonoBold', '/usr/share/fonts/truetype/chinese/SarasaMonoSC-Bold.ttf'))
pdfmetrics.registerFont(TTFont('Carlito', '/usr/share/fonts/truetype/english/Carlito-Regular.ttf'))
pdfmetrics.registerFont(TTFont('CarlitoBold', '/usr/share/fonts/truetype/english/Carlito-Bold.ttf'))
pdfmetrics.registerFont(TTFont('DejaVuSans', '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'))

registerFontFamily('NotoSerifSC', normal='NotoSerifSC', bold='NotoSerifSCBold')
registerFontFamily('SarasaMono', normal='SarasaMono', bold='SarasaMonoBold')
registerFontFamily('Carlito', normal='Carlito', bold='CarlitoBold')

# ── 调色板 ────────────────────────────────────────────────
ACCENT       = colors.HexColor('#2f97b9')
TEXT_PRIMARY  = colors.HexColor('#252422')
TEXT_MUTED    = colors.HexColor('#8d8981')
BG_SURFACE    = colors.HexColor('#dfdad2')
BG_PAGE       = colors.HexColor('#f5f4f3')

TABLE_HEADER_COLOR = ACCENT
TABLE_HEADER_TEXT  = colors.white
TABLE_ROW_EVEN     = colors.white
TABLE_ROW_ODD      = BG_SURFACE

# ── 样式定义 ──────────────────────────────────────────────
PAGE_W, PAGE_H = A4
LEFT_M = 1.0 * inch
RIGHT_M = 1.0 * inch
TOP_M = 0.8 * inch
BOTTOM_M = 0.8 * inch
AVAILABLE_W = PAGE_W - LEFT_M - RIGHT_M

styles = getSampleStyleSheet()

h1_style = ParagraphStyle(
    name='H1', fontName='NotoSerifSC', fontSize=20, leading=30,
    textColor=ACCENT, spaceBefore=24, spaceAfter=12, wordWrap='CJK'
)
h2_style = ParagraphStyle(
    name='H2', fontName='NotoSerifSC', fontSize=16, leading=24,
    textColor=TEXT_PRIMARY, spaceBefore=18, spaceAfter=8, wordWrap='CJK'
)
h3_style = ParagraphStyle(
    name='H3', fontName='NotoSerifSC', fontSize=13, leading=20,
    textColor=TEXT_PRIMARY, spaceBefore=12, spaceAfter=6, wordWrap='CJK'
)
body_style = ParagraphStyle(
    name='Body', fontName='SarasaMono', fontSize=10.5, leading=18,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK',
    spaceBefore=0, spaceAfter=6, firstLineIndent=21
)
body_no_indent = ParagraphStyle(
    name='BodyNoIndent', fontName='SarasaMono', fontSize=10.5, leading=18,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK',
    spaceBefore=0, spaceAfter=6
)
code_style = ParagraphStyle(
    name='Code', fontName='DejaVuSans', fontSize=9, leading=14,
    textColor=colors.HexColor('#1a1a2e'), backColor=colors.HexColor('#f0f0f5'),
    leftIndent=12, rightIndent=12, spaceBefore=6, spaceAfter=6,
    wordWrap='CJK', borderPadding=6
)
bullet_style = ParagraphStyle(
    name='Bullet', fontName='SarasaMono', fontSize=10.5, leading=18,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK',
    leftIndent=24, bulletIndent=12, spaceBefore=2, spaceAfter=2
)
caption_style = ParagraphStyle(
    name='Caption', fontName='SarasaMono', fontSize=9, leading=14,
    textColor=TEXT_MUTED, alignment=TA_CENTER, spaceBefore=3, spaceAfter=6
)
header_cell_style = ParagraphStyle(
    name='HeaderCell', fontName='SarasaMono', fontSize=10, leading=15,
    textColor=colors.white, alignment=TA_CENTER, wordWrap='CJK'
)
cell_style = ParagraphStyle(
    name='Cell', fontName='SarasaMono', fontSize=9.5, leading=14,
    textColor=TEXT_PRIMARY, alignment=TA_LEFT, wordWrap='CJK'
)
cell_center_style = ParagraphStyle(
    name='CellCenter', fontName='SarasaMono', fontSize=9.5, leading=14,
    textColor=TEXT_PRIMARY, alignment=TA_CENTER, wordWrap='CJK'
)

# ── 辅助函数 ──────────────────────────────────────────────
def h1(text):
    return Paragraph(f'<b>{text}</b>', h1_style)

def h2(text):
    return Paragraph(f'<b>{text}</b>', h2_style)

def h3(text):
    return Paragraph(f'<b>{text}</b>', h3_style)

def p(text):
    return Paragraph(text, body_style)

def p_ni(text):
    return Paragraph(text, body_no_indent)

def bullet(text):
    return Paragraph(f'<bullet>&bull;</bullet>{text}', bullet_style)

def code(text):
    return Paragraph(text, code_style)

def make_table(headers, rows, col_ratios=None):
    """创建标准格式表格"""
    if col_ratios is None:
        col_ratios = [1.0 / len(headers)] * len(headers)
    col_widths = [r * AVAILABLE_W for r in col_ratios]

    data = []
    header_row = [Paragraph(f'<b>{h}</b>', header_cell_style) for h in headers]
    data.append(header_row)
    for row in rows:
        data.append([Paragraph(str(c), cell_style) for c in row])

    table = Table(data, colWidths=col_widths, hAlign='CENTER')
    style_cmds = [
        ('BACKGROUND', (0, 0), (-1, 0), TABLE_HEADER_COLOR),
        ('TEXTCOLOR', (0, 0), (-1, 0), TABLE_HEADER_TEXT),
        ('GRID', (0, 0), (-1, -1), 0.5, TEXT_MUTED),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
    ]
    for i in range(1, len(data)):
        bg = TABLE_ROW_EVEN if i % 2 == 1 else TABLE_ROW_ODD
        style_cmds.append(('BACKGROUND', (0, i), (-1, i), bg))
    table.setStyle(TableStyle(style_cmds))
    return table

def safe_keep(elements):
    """安全 KeepTogether"""
    total_h = 0
    for el in elements:
        w, h = el.wrap(AVAILABLE_W, PAGE_H)
        total_h += h
    if total_h <= PAGE_H * 0.4:
        return [KeepTogether(elements)]
    elif len(elements) >= 2:
        return [KeepTogether(elements[:2])] + list(elements[2:])
    return list(elements)

# ── 文档构建 ──────────────────────────────────────────────
output_path = '/home/z/my-project/download/fin-agent-architecture.pdf'

doc = SimpleDocTemplate(
    output_path,
    pagesize=A4,
    leftMargin=LEFT_M, rightMargin=RIGHT_M,
    topMargin=TOP_M, bottomMargin=BOTTOM_M,
    title='金融分析Agent架构设计文档',
    author='Z.ai',
    creator='Z.ai'
)

story = []

# ══════════════════════════════════════════════════════════
# 封面页
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 120))
cover_title = ParagraphStyle(
    name='CoverTitle', fontName='NotoSerifSC', fontSize=36, leading=50,
    textColor=ACCENT, alignment=TA_CENTER, wordWrap='CJK'
)
cover_sub = ParagraphStyle(
    name='CoverSub', fontName='SarasaMono', fontSize=16, leading=24,
    textColor=TEXT_MUTED, alignment=TA_CENTER, wordWrap='CJK'
)
cover_meta = ParagraphStyle(
    name='CoverMeta', fontName='SarasaMono', fontSize=12, leading=18,
    textColor=TEXT_MUTED, alignment=TA_CENTER, wordWrap='CJK'
)
story.append(Paragraph('<b>金融分析 Agent</b>', cover_title))
story.append(Paragraph('<b>Skill + MCP 架构设计文档</b>', cover_title))
story.append(Spacer(1, 30))
story.append(Paragraph('多信号融合 / 逻辑一致性 / 经验学习 / 技术位分析', cover_sub))
story.append(Spacer(1, 60))
story.append(Paragraph('版本 1.0 | 2026-05-22', cover_meta))
story.append(Paragraph('Z.ai', cover_meta))
story.append(PageBreak())

# ══════════════════════════════════════════════════════════
# 第一章：架构总览
# ══════════════════════════════════════════════════════════
story.append(h1('一、架构总览'))

story.append(p('金融分析 Agent 的核心设计目标是：通过 Skill + MCP 的分层架构，实现每日自动化的市场扫描、板块轮动分析、多信号融合判断，同时解决新闻情绪过度依赖、缺乏长期记忆、逻辑一致性缺失等关键问题。整个系统由三个核心层构成：数据层（MCP Server）、决策层（Skill Engine）、记忆层（SQLite Store），三者通过标准化的 MCP 协议进行通信，确保各层独立演进、松耦合协作。'))

story.append(Spacer(1, 12))
story.append(h2('1.1 三层架构'))

story.append(p('数据层（MCP Server）负责从 Finance API Gateway 获取实时市场数据、新闻、财报等信息，并通过标准化的 MCP Tool 接口暴露给上层。决策层（Skill Engine）是整个 Agent 的大脑，负责多信号融合、逻辑一致性校验、经验规则应用等核心决策逻辑。记忆层（SQLite Store）提供持久化存储，记录历史判断、验证结果和经验规则，使 Agent 能够从过去的成功与失败中学习，逐步提升判断质量。'))

story.append(Spacer(1, 12))
story.append(make_table(
    ['层级', '组件', '职责', '技术栈'],
    [
        ['数据层', 'fin-agent-mcp-server', '市场数据聚合、技术指标计算、新闻情绪分析', 'MCP SDK + Finance API'],
        ['决策层', 'fin-agent-skill', '多信号融合、一致性校验、经验学习、报告生成', 'Z-AI-SDK + TypeScript'],
        ['记忆层', 'SQLite Store', '历史判断、验证结果、经验规则、命中率统计', 'SQLite3 + 遗忘曲线'],
    ],
    [0.10, 0.22, 0.40, 0.28]
))
story.append(Paragraph('表1：三层架构组件概览', caption_style))

story.append(Spacer(1, 18))
story.append(h2('1.2 Skill + MCP 是好的选择吗？'))

story.append(p('是的，Skill + MCP 是当前构建金融分析 Agent 的最佳架构选择，原因如下：'))

story.append(bullet('<b>关注点分离</b>：MCP Server 专注数据获取和预处理，Skill 专注决策逻辑和报告生成。数据层变更（如更换数据源）不影响决策层，决策层迭代（如调整权重）不需要修改数据层。这种分离使得系统各部分可以独立演进，降低了维护成本和出错概率。'))
story.append(bullet('<b>标准化接口</b>：MCP 协议提供了标准化的 Tool 调用接口，Agent 可以像调用函数一样调用 MCP Server 的能力。这意味着你可以轻松替换或增加数据源（如从路透社扩展到彭博），而不需要修改 Skill 的核心逻辑。'))
story.append(bullet('<b>可组合性</b>：一个 Agent 可以同时连接多个 MCP Server（如金融数据 MCP + 新闻情绪 MCP + 宏观经济 MCP），通过组合不同的 MCP Server 构建更强大的分析能力。这种"乐高积木"式的架构使得系统扩展极为灵活。'))
story.append(bullet('<b>记忆持久化</b>：MCP Server 内置 SQLite 记忆层，历史判断和经验规则不会因 Agent 重启而丢失。这是解决"缺乏记忆"问题的关键基础设施。'))
story.append(bullet('<b>定时任务友好</b>：Skill 可以通过 Cron Job 每日定时触发，MCP Server 常驻后台提供服务，两者配合实现全自动化的每日分析流程。'))

story.append(Spacer(1, 12))
story.append(p('然而，Skill + MCP 也有需要注意的局限：MCP 的 Tool 调用是同步的，对于需要实时推送的场景（如盘中异动监控），需要额外引入 WebSocket 或 SSE 机制。此外，MCP Server 的状态管理需要谨慎设计，避免并发写入 SQLite 时的锁竞争问题。'))

# ══════════════════════════════════════════════════════════
# 第二章：MCP 服务器设计
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('二、MCP 服务器设计'))

story.append(p('fin-agent-mcp-server 是整个系统的数据中枢，通过 10 个标准化 MCP Tool 为上层 Skill 提供全面的市场数据、技术分析、情绪分析和记忆管理能力。每个 Tool 都经过精心设计，确保数据获取的实时性、分析的准确性和接口的一致性。'))

story.append(Spacer(1, 12))
story.append(h2('2.1 MCP Tool 清单'))

story.append(make_table(
    ['Tool 名称', '功能', '输出', '调用频率'],
    [
        ['market_snapshot', '市场快照：指数/板块/成交量/VIX', '指数报价+板块ETF+新闻标题', '每日2次'],
        ['sector_rotation', '板块轮动：相对强度/资金流向', '强势/弱势板块Top3+轮动信号', '每日1次'],
        ['technical_levels', '技术位：支撑/阻力/均线/指标', '枢轴点+均线+RSI/MACD/布林带+操作点', '按需调用'],
        ['news_sentiment', '新闻情绪（带衰减）', '情绪分数+衰减分数+背离预警', '每日1次'],
        ['fundamental_scan', '基本面扫描：财报/估值/盈利质量', '估值+盈利+成长+质量+分析师评级', '每周1次'],
        ['signal_fusion', '多信号融合（核心引擎）', '方向+置信度+操作建议+一致性报告', '每日1次'],
        ['memory_query', '查询历史判断与验证', '历史判断+命中率+偏差度', '按需调用'],
        ['memory_record', '记录新判断或验证结果', '确认记录', '自动+手动'],
        ['consistency_check', '逻辑一致性校验', '一致性评分+翻转历史+改进建议', '每次判断后'],
        ['experience_learn', '经验学习：提炼/更新/淘汰规则', '新规则+更新规则+淘汰规则', '每日/每周'],
    ],
    [0.16, 0.28, 0.30, 0.14]
))
story.append(Paragraph('表2：MCP Tool 完整清单', caption_style))

story.append(Spacer(1, 18))
story.append(h2('2.2 数据流架构'))

story.append(p('数据从 Finance API Gateway 流入 MCP Server，经过各 Tool 的处理后，以结构化 JSON 格式通过 MCP 协议返回给 Skill Engine。整个数据流遵循"原始数据 → 预处理 → 分析 → 融合"的四阶段管线，每个阶段的输出都是下一阶段的输入，确保数据处理的层次性和可追溯性。'))

story.append(p('在原始数据阶段，MCP Server 从 Finance API Gateway 获取股票报价、历史K线、财报数据、新闻列表等原始信息。预处理阶段对原始数据进行清洗、归一化和格式化，例如将不同来源的价格数据统一为标准格式，将新闻文本进行情绪分析。分析阶段运行技术指标计算、基本面评分、情绪衰减等分析逻辑。融合阶段将所有信号按权重加权求和，并经过一致性校验和经验修正后输出最终判断。'))

# ══════════════════════════════════════════════════════════
# 第三章：解决新闻情绪过度依赖
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('三、解决新闻情绪过度依赖'))

story.append(p('新闻情绪过度依赖是金融分析 Agent 最常见的问题之一。新闻具有天然的滞后性和偏向性：利好消息往往在上涨后才大量出现（确认偏见），利空消息在下跌后被过度放大（损失厌恶）。如果 Agent 过度依赖新闻情绪，很容易在顶部看多、底部看空，成为"追涨杀跌"的反向指标。本架构通过五层防护机制彻底解决这一问题。'))

story.append(Spacer(1, 12))
story.append(h2('3.1 五层防护机制'))

story.append(Spacer(1, 6))
story.append(h3('第一层：权重硬上限'))

story.append(p('在 signal_fusion Tool 中，新闻情绪的权重被硬编码为不超过 15%。这意味着即使新闻情绪极度看多（+1.0），其对最终融合分数的影响也不超过 0.15 分。相比之下，技术面（40%）和基本面（35%）合计占 75%，确保价格行为和财务数据始终是决策的主导因素。权重硬上限是在代码层面强制执行的，无法通过参数调整绕过，从架构层面杜绝了情绪主导的可能性。'))

story.append(Spacer(1, 6))
story.append(h3('第二层：时间衰减因子'))

story.append(p('新闻的影响力随时间指数衰减，半衰期设为 24 小时。这意味着一条 24 小时前的新闻，其情绪影响已衰减 50%；48 小时前的新闻，影响仅剩 25%。衰减公式为：adjusted_score = raw_score * exp(-0.693 * age_hours / 24)。这一机制确保 Agent 不会被旧新闻持续影响，始终关注最新的市场动态。同时，时间衰减也自然过滤了"新闻轰炸"效应——当某一天出现大量同向新闻时，随着时间推移，它们的集体影响会迅速消退。'))

story.append(Spacer(1, 6))
story.append(h3('第三层：来源可信度加权'))

story.append(p('不同新闻来源的可信度差异巨大。路透社和彭博的新闻通常基于事实和权威信源，可信度设为 0.93-0.95；社交媒体（Twitter/Reddit）上的信息往往未经证实，可信度仅 0.25-0.30。每条新闻的情绪分数会乘以其来源的可信度权重，再参与整体情绪计算。这一机制有效降低了谣言和未经证实信息对判断的干扰，同时确保权威信源的声音得到应有的重视。'))

story.append(Spacer(1, 6))
story.append(h3('第四层：极端情绪自动降权'))

story.append(p('当新闻情绪达到极端值（绝对值超过 0.8）时，系统自动将其视为潜在的反向指标。历史数据表明，极端看多往往出现在市场顶部，极端看空往往出现在市场底部。因此，当情绪分数超过 0.8 时，系统将其乘以一个衰减因子（如 0.6），降低极端情绪的影响。同时触发"情绪极端预警"，提醒 Agent 注意可能的情绪拐点。'))

story.append(Spacer(1, 6))
story.append(h3('第五层：情绪-价格背离检测'))

story.append(p('当新闻情绪与价格走势出现背离时（如情绪看多但价格持续走弱，或情绪看空但价格企稳回升），系统自动触发背离预警。背离是最有价值的市场信号之一，它意味着"市场正在用脚投票"，与新闻叙事方向相反。系统会输出背离类型（看多背离/看空背离）、背离强度和持续天数，供 Agent 在融合判断时参考。经验表明，情绪-价格背离往往预示着趋势反转，是比情绪本身更可靠的信号。'))

story.append(Spacer(1, 12))
story.append(make_table(
    ['防护层', '机制', '效果', '实现位置'],
    [
        ['第一层', '权重硬上限 15%', '情绪对最终判断影响不超过 0.15 分', 'signal_fusion'],
        ['第二层', '时间衰减（半衰期24h）', '旧新闻影响迅速消退', 'news_sentiment'],
        ['第三层', '来源可信度加权', '路透社 0.95 > 社交媒体 0.25', 'news_sentiment'],
        ['第四层', '极端情绪降权', '极端值乘以 0.6 衰减因子', 'news_sentiment'],
        ['第五层', '情绪-价格背离检测', '背离预警，预示趋势反转', 'news_sentiment'],
    ],
    [0.10, 0.22, 0.38, 0.18]
))
story.append(Paragraph('表3：新闻情绪五层防护机制', caption_style))

# ══════════════════════════════════════════════════════════
# 第四章：解决缺乏记忆与逻辑一致性
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('四、解决缺乏记忆与逻辑一致性'))

story.append(p('传统 Agent 的两个致命缺陷是：每次分析都是"无状态"的，无法记住过去的判断；前后判断可能自相矛盾，缺乏逻辑一致性。本架构通过三层记忆系统和一致性引擎彻底解决这些问题，使 Agent 能够像人类分析师一样积累经验、保持逻辑连贯。'))

story.append(Spacer(1, 12))
story.append(h2('4.1 三层记忆系统'))

story.append(Spacer(1, 6))
story.append(h3('短期记忆：判断记录（judgments 表）'))

story.append(p('每次 signal_fusion 调用都会自动将判断结果写入 judgments 表，记录内容包括：标的代码、判断方向（看多/看空/中性）、置信度、判断理由、关键因素列表、目标价、止损价、时间框架和信号来源权重。这些记录是后续一致性校验和经验学习的基础数据。系统不会遗漏任何一次判断，确保记忆的完整性。每条记录都有时间戳，支持按时间范围查询和遗忘曲线衰减计算。'))

story.append(Spacer(1, 6))
story.append(h3('中期记忆：验证结果（validations 表）'))

story.append(p('验证是经验学习的关键环节。系统定期（每日收盘后）将历史判断与实际走势对比，记录方向是否命中、实际涨跌幅、偏差度等指标。验证结果写入 validations 表，与对应的 judgment 通过外键关联。通过统计命中率、平均偏差度等指标，系统可以评估自身判断的准确性，识别哪些信号源更可靠、哪些市场环境下判断更准确。验证结果也是经验规则提炼的输入数据。'))

story.append(Spacer(1, 6))
story.append(h3('长期记忆：经验规则（experience 表）'))

story.append(p('经验规则是从大量判断-验证对中提炼出的"智慧结晶"，格式为自然语言描述 + 分类 + 置信度 + 命中/未命中计数。例如："科技股财报前3天看多信号准确率低于40%，应降低置信度"。经验规则有动态置信度，每次验证后根据命中/未命中结果调整：命中则置信度上升，未命中则下降。过时规则（90天未验证或命中率过低）会被自动淘汰。经验规则直接影响 signal_fusion 的权重分配——命中率高的信号源权重提升，命中率低的权重降低。'))

story.append(Spacer(1, 12))
story.append(h2('4.2 遗忘曲线'))

story.append(p('并非所有记忆都同等重要。系统采用类似人类记忆的遗忘曲线机制，越旧的判断权重越低。遗忘公式为：weight = exp(-0.693 * age_days / 30)，半衰期为 30 天。这意味着一个月前的判断权重为 50%，两个月前为 25%，三个月前仅为 12.5%。遗忘曲线确保 Agent 不会被过时的判断束缚，同时保留近期判断的参考价值。在一致性校验中，近期判断的翻转比远期判断的翻转受到更严格的审查。'))

story.append(Spacer(1, 12))
story.append(h2('4.3 逻辑一致性引擎'))

story.append(p('一致性引擎是防止 Agent "自相矛盾"的核心组件。每次新判断在输出前都必须经过一致性校验，校验流程包含四个检查点：'))

story.append(bullet('<b>方向翻转检测</b>：如果新判断方向与最近一次判断相反（如从看多翻转为看空），系统要求提供"翻转理由"。没有充分理由的翻转会被降低置信度。这是防止 Agent 随意改变立场的关键机制。'))
story.append(bullet('<b>震荡模式检测</b>：如果 30 天内方向翻转超过 3 次，系统判定进入"震荡模式"，自动暂停判断 3 天（冷却期）。震荡模式通常意味着信号不明确，此时最好的策略是观望而非频繁操作。'))
story.append(bullet('<b>置信度波动检测</b>：如果新判断的置信度与上次判断相差超过 15%，系统要求解释波动原因。大幅波动可能意味着信号源不稳定或分析逻辑有问题。'))
story.append(bullet('<b>确认偏见检测</b>：如果连续 5 次以上同方向判断且置信度持续偏高，系统发出"确认偏见"警告，提醒 Agent 可能存在选择性采纳信号的问题。'))

story.append(Spacer(1, 12))
story.append(make_table(
    ['检查点', '触发条件', '后果', '目的'],
    [
        ['方向翻转', '新方向与上次相反', '要求翻转理由，否则降低置信度', '防止随意改变立场'],
        ['震荡模式', '30天内翻转>=3次', '暂停判断3天（冷却期）', '避免频繁操作'],
        ['置信度波动', '置信度变化>15%', '要求解释波动原因', '检测信号源稳定性'],
        ['确认偏见', '连续5次同方向+高置信度', '发出确认偏见警告', '防止选择性采纳信号'],
    ],
    [0.14, 0.24, 0.30, 0.24]
))
story.append(Paragraph('表4：一致性引擎检查点', caption_style))

# ══════════════════════════════════════════════════════════
# 第五章：技术位计算与操作建议
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('五、技术位计算与操作建议'))

story.append(p('technical_levels Tool 是 Agent 告诉你"接下来该怎么操作"的核心能力。它通过多维度技术分析，自动计算关键价位、识别趋势方向、标注操作点，并给出具体的入场/出场/止损建议。'))

story.append(Spacer(1, 12))
story.append(h2('5.1 技术位计算体系'))

story.append(p('技术位计算采用"枢轴点法 + 均线系统 + 指标信号 + 关键价位"四维体系，每个维度独立计算后交叉验证，确保关键价位的可靠性。'))

story.append(Spacer(1, 6))
story.append(h3('枢轴点系统'))

story.append(p('枢轴点（Pivot Points）是基于前一日最高价、最低价和收盘价计算的关键价位。枢轴点本身是当日多空分水岭，上方三个阻力位（R1/R2/R3）由强到弱，下方三个支撑位（S1/S2/S3）由强到弱。计算公式为：PP = (H + L + C) / 3，R1 = 2*PP - L，S1 = 2*PP - H，R2 = PP + (H - L)，S2 = PP - (H - L)。枢轴点法的优势在于它是市场参与者广泛使用的参考价位，具有自我实现的预言效应。'))

story.append(Spacer(1, 6))
story.append(h3('均线系统'))

story.append(p('系统计算 MA5/MA10/MA20/MA60/MA120/MA250 六条均线，覆盖短期（5-10日）、中期（20-60日）和长期（120-250日）三个时间框架。均线的作用包括：趋势方向判断（价格在均线之上为上升趋势）、支撑阻力识别（MA20 和 MA60 是最常用的支撑/阻力位）、金叉死叉信号（短期均线上穿长期均线为金叉，看多；反之为死叉，看空）。系统会自动检测均线交叉信号，并将其纳入操作建议。'))

story.append(Spacer(1, 6))
story.append(h3('技术指标信号'))

story.append(p('RSI（相对强弱指标）用于判断超买超卖：RSI > 70 为超买区域，RSI < 30 为超卖区域。MACD 用于判断趋势强度和方向：MACD 柱状图由负转正为买入信号，由正转负为卖出信号。布林带用于判断波动率和极端价位：价格触及上轨可能超买，触及下轨可能超卖。三个指标交叉验证，当多个指标同时发出同向信号时，操作建议的置信度显著提升。'))

story.append(Spacer(1, 12))
story.append(h2('5.2 操作点生成逻辑'))

story.append(p('系统根据技术位计算结果自动生成操作点，每个操作点包含：价格、操作类型（买入/卖出/止损/止盈）、置信度和理由。操作点按置信度从高到低排序，最多返回 8 个。生成逻辑遵循以下优先级：'))

story.append(bullet('<b>趋势跟踪止损</b>（置信度 75%）：上升趋势中，MA20 作为跟踪止损位；下降趋势中，MA20 作为反弹卖出位。这是最核心的操作点，确保在趋势延续时持有、趋势反转时及时退出。'))
story.append(bullet('<b>关键支撑/阻力位操作</b>（置信度 55-70%）：强支撑位附近生成买入操作点，强阻力位附近生成止盈操作点。支撑/阻力位的强度由触及次数和持续时间决定。'))
story.append(bullet('<b>RSI 超买超卖操作</b>（置信度 65%）：RSI < 30 生成买入操作点，RSI > 70 生成卖出操作点。'))
story.append(bullet('<b>MACD 金叉死叉操作</b>（置信度 65%）：金叉生成买入操作点，死叉生成卖出操作点。'))
story.append(bullet('<b>布林带触轨操作</b>（置信度 60%）：触及下轨生成买入操作点，触及上轨生成卖出操作点。'))

story.append(Spacer(1, 12))
story.append(h2('5.3 操作建议输出示例'))

story.append(p('以下是一个典型的操作建议输出结构，展示了 Agent 如何将技术分析转化为可执行的操作指令：'))

story.append(Spacer(1, 6))
story.append(make_table(
    ['操作类型', '价格', '置信度', '理由'],
    [
        ['止损(跟踪)', '$182.50', '75%', '上升趋势中MA20作为跟踪止损'],
        ['买入', '$178.20', '70%', '关键支撑位: 前低点+整数关口'],
        ['买入', '$175.80', '65%', 'RSI=28,超卖区域'],
        ['止盈', '$195.00', '70%', '关键阻力位: 前高点+R2枢轴点'],
        ['卖出', '$198.50', '65%', 'MACD死叉,柱状图=-1.23'],
    ],
    [0.14, 0.12, 0.10, 0.50]
))
story.append(Paragraph('表5：操作建议输出示例（以纳斯达克100 ETF为例）', caption_style))

# ══════════════════════════════════════════════════════════
# 第六章：经验学习系统
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('六、经验学习系统'))

story.append(p('经验学习系统是 Agent 从"新手"成长为"老手"的关键。它通过持续的"判断 → 验证 → 提炼 → 应用"循环，使 Agent 的判断质量随时间推移不断提升。这是解决"缺乏记忆"问题最核心的机制——不仅仅是记住过去，更是从过去中学习。'))

story.append(Spacer(1, 12))
story.append(h2('6.1 学习循环'))

story.append(p('经验学习遵循四个阶段的循环：第一阶段是"判断记录"，每次 signal_fusion 调用都会自动将判断结果写入记忆层，包括方向、置信度、理由和信号来源权重。第二阶段是"结果验证"，每日收盘后系统自动将历史判断与实际走势对比，记录方向命中率和偏差度。第三阶段是"规则提炼"，每周系统分析验证结果，提炼出经验规则。例如，如果发现"科技股财报前看多信号命中率仅35%"，就会生成一条经验规则。第四阶段是"规则应用"，经验规则直接影响后续判断的权重分配和置信度调整。'))

story.append(Spacer(1, 12))
story.append(h2('6.2 经验规则示例'))

story.append(make_table(
    ['规则', '分类', '置信度', '命中/未命中'],
    [
        ['科技股财报前3天看多信号准确率低于40%', 'fundamental', '65%', '8/5'],
        ['VIX > 25时看多判断应降低置信度20%', 'macro', '72%', '12/3'],
        ['板块轮动信号在周一准确率最高', 'technical', '58%', '6/4'],
        ['连续3天同方向新闻后反转概率>60%', 'sentiment', '68%', '10/5'],
        ['纳斯达克在美联储议息前一周波动率上升', 'macro', '75%', '9/2'],
    ],
    [0.44, 0.14, 0.10, 0.12]
))
story.append(Paragraph('表6：经验规则示例', caption_style))

story.append(Spacer(1, 12))
story.append(h2('6.3 权重动态调整'))

story.append(p('经验规则不仅提供定性指导，还直接影响信号权重分配。ExperienceEngine 的 adjustWeights 方法根据各信号源的历史命中率动态调整权重：命中率高于 60% 的信号源权重提升 5-10%，命中率低于 40% 的信号源权重降低 5-10%。调整后的权重会重新归一化，且情绪权重仍然受 15% 硬上限约束。这意味着随着经验积累，Agent 会自动"信任"更可靠的信号源，"怀疑"不太可靠的信号源，实现判断质量的持续优化。'))

# ══════════════════════════════════════════════════════════
# 第七章：每日工作流
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('七、每日工作流'))

story.append(p('完整的每日分析流程由 Skill Engine 编排，通过 Cron Job 在每个交易日美东 9:00 自动触发。流程包含六个步骤，从全局扫描到个股分析，从信号融合到一致性校验，最终输出结构化的每日报告。'))

story.append(Spacer(1, 12))
story.append(make_table(
    ['步骤', '调用 Tool', '内容', '耗时估计'],
    [
        ['1. 市场快照', 'market_snapshot', '获取主要指数、板块ETF、VIX、新闻标题', '10秒'],
        ['2. 板块轮动', 'sector_rotation', '计算11个板块相对强度，识别强势/弱势板块', '15秒'],
        ['3. 标的筛选', 'sector_rotation结果', '从强势板块中选择代表性标的(6-8只)', '5秒'],
        ['4. 多信号融合', 'signal_fusion', '对每只标的执行技术+基本面+情绪+宏观融合', '60秒'],
        ['5. 一致性校验', 'consistency_check', '检查新判断与历史判断的一致性', '10秒'],
        ['6. 经验学习', 'experience_learn', '回顾昨日判断，提炼/更新经验规则', '15秒'],
    ],
    [0.08, 0.18, 0.48, 0.10]
))
story.append(Paragraph('表7：每日分析工作流', caption_style))

story.append(Spacer(1, 12))
story.append(p('每周五收盘后，系统还会执行周度回顾流程（weekly），包括：统计本周判断命中率、与上周对比、提炼周度经验规则、淘汰过时规则、调整信号权重。周度回顾是 Agent 持续改进的核心机制，确保经验库始终保持高质量和时效性。'))

# ══════════════════════════════════════════════════════════
# 第八章：信号权重体系
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('八、信号权重体系'))

story.append(p('信号权重体系是整个架构的核心参数，直接决定了 Agent 的判断倾向。权重分配遵循"客观信号优先"原则：技术面和基本面是最客观、最难被操纵的信号，因此占据最大权重；新闻情绪最容易被操纵和滞后，因此权重最低且有硬上限。'))

story.append(Spacer(1, 12))
story.append(make_table(
    ['信号来源', '默认权重', '调整范围', '硬上限', '依据'],
    [
        ['技术面', '40%', '35%-50%', '无', '价格/量/指标最客观，最难操纵'],
        ['基本面', '35%', '25%-40%', '无', '财报/估值有审计保障，可信度高'],
        ['新闻情绪', '15%', '5%-15%', '15%', '易滞后/操纵，硬上限防过度依赖'],
        ['宏观环境', '10%', '5%-15%', '无', '影响长期趋势，短期影响有限'],
    ],
    [0.10, 0.10, 0.12, 0.08, 0.42]
))
story.append(Paragraph('表8：信号权重体系', caption_style))

story.append(Spacer(1, 12))
story.append(p('权重调整由 ExperienceEngine 根据历史命中率自动执行。例如，如果技术面信号近 90 天命中率为 72%，而基本面信号命中率为 48%，系统会自动将技术面权重从 40% 提升至 45%，基本面权重从 35% 降低至 30%。所有调整都会重新归一化，确保总权重为 100%，且情绪权重不超过 15% 硬上限。'))

# ══════════════════════════════════════════════════════════
# 第九章：部署与配置
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('九、部署与配置'))

story.append(Spacer(1, 6))
story.append(h2('9.1 目录结构'))

story.append(p_ni('fin-agent/'))
story.append(p_ni('  fin-agent-mcp-server/     # MCP 服务器'))
story.append(p_ni('    src/'))
story.append(p_ni('      index.ts              # 入口：注册所有 MCP Tools'))
story.append(p_ni('      memory/'))
story.append(p_ni('        sqliteStore.ts      # SQLite 记忆层（三张核心表）'))
story.append(p_ni('      tools/'))
story.append(p_ni('        marketSnapshot.ts   # 市场快照 Tool'))
story.append(p_ni('        sectorRotation.ts   # 板块轮动 Tool'))
story.append(p_ni('        technicalLevels.ts  # 技术位计算 Tool'))
story.append(p_ni('        newsSentiment.ts    # 新闻情绪 Tool（五层防护）'))
story.append(p_ni('        fundamentalScan.ts  # 基本面扫描 Tool'))
story.append(p_ni('        signalFusion.ts     # 多信号融合 Tool（核心引擎）'))
story.append(p_ni('        memoryTools.ts      # 记忆查询/记录 Tool'))
story.append(p_ni('        consistencyCheck.ts # 一致性校验 Tool'))
story.append(p_ni('        experienceLearn.ts  # 经验学习 Tool'))
story.append(p_ni('    package.json'))
story.append(p_ni('    tsconfig.json'))
story.append(p_ni('  fin-agent-skill/          # Skill 决策层'))
story.append(p_ni('    src/'))
story.append(p_ni('      index.ts              # 主入口：daily/weekly/analyze'))
story.append(p_ni('      engines/'))
story.append(p_ni('        consistencyEngine.ts # 一致性引擎'))
story.append(p_ni('        experienceEngine.ts # 经验学习引擎'))
story.append(p_ni('    SKILL.md                # Skill 描述文件'))
story.append(p_ni('    package.json'))
story.append(p_ni('  fin-agent-config.json     # 全局配置（MCP/Cron/权重/风控）'))

story.append(Spacer(1, 12))
story.append(h2('9.2 配置说明'))

story.append(p('全局配置文件 fin-agent-config.json 包含四个部分：MCP 服务器连接配置（指定 MCP Server 的启动命令和环境变量）、Cron Job 定时任务配置（每日分析和每周回顾的触发时间）、信号权重配置（默认权重和调整范围）、风控参数配置（最大仓位、默认止损、最小风险收益比、每日最大交易次数、震荡冷却期）。所有配置都支持通过环境变量覆盖，方便在不同环境（开发/测试/生产）间切换。'))

story.append(Spacer(1, 12))
story.append(h2('9.3 启动步骤'))

story.append(p('部署分为三步：第一步，构建 MCP Server：进入 fin-agent-mcp-server 目录，执行 npm install && npm run build，生成 dist/ 目录。第二步，构建 Skill：进入 fin-agent-skill 目录，执行 npm install && npm run build。第三步，配置 Agent：在 Agent 的 MCP 配置中添加 fin-agent-mcp-server 的连接信息，在 Cron Job 中添加每日和每周的定时任务。启动后，MCP Server 会常驻后台，Skill 通过 MCP 协议调用 Server 的 Tools，Cron Job 按计划自动触发每日分析流程。'))

# ══════════════════════════════════════════════════════════
# 第十章：问题解决方案总结
# ══════════════════════════════════════════════════════════
story.append(Spacer(1, 24))
story.append(h1('十、问题解决方案总结'))

story.append(p('本架构针对用户提出的四个核心问题，提供了系统化的解决方案。下表汇总了每个问题的根本原因、解决机制和预期效果。'))

story.append(Spacer(1, 12))
story.append(make_table(
    ['核心问题', '根本原因', '解决机制', '预期效果'],
    [
        ['新闻情绪过度依赖', '情绪权重无上限+无时间衰减+无来源区分', '五层防护：权重硬上限15%+时间衰减+来源可信度+极端降权+背离检测', '情绪对判断影响不超过15%，极端情绪自动降权'],
        ['缺乏长期记忆', '每次分析无状态+判断不记录+经验不积累', '三层记忆：判断记录+验证结果+经验规则，SQLite持久化+遗忘曲线', 'Agent可回溯任意历史判断，经验规则持续积累'],
        ['逻辑一致性缺失', '无历史对比+翻转无约束+置信度随意波动', '一致性引擎：翻转检测+震荡模式+置信度波动+确认偏见四重检查', '方向翻转需理由，震荡自动暂停，一致性评分量化'],
        ['技术位与操作点', '缺乏技术分析能力+无法给出具体操作建议', '四维技术位：枢轴点+均线+指标+关键价位，自动生成操作点', '每只标的输出5-8个操作点，含价格/类型/置信度/理由'],
    ],
    [0.14, 0.24, 0.34, 0.24]
))
story.append(Paragraph('表9：核心问题解决方案总结', caption_style))

story.append(Spacer(1, 18))
story.append(p('通过 Skill + MCP 的分层架构，配合三层记忆系统和一致性引擎，金融分析 Agent 能够实现从"无状态反应式分析"到"有记忆渐进式学习"的质变。Agent 不再是每次都从零开始的"新手"，而是随着经验积累不断成长的"分析师"。信号权重体系确保技术面和基本面始终主导决策，新闻情绪被严格约束在辅助角色。技术位计算和操作点生成使 Agent 的输出从"模糊的方向判断"升级为"可执行的操作指令"。整个系统是可扩展的——你可以随时添加新的 MCP Server（如期权数据、加密货币、宏观经济指标），Skill Engine 会自动将新数据源纳入融合分析。'))

# ── 构建文档 ──────────────────────────────────────────────
doc.build(story)
print(f"PDF 已生成: {output_path}")
