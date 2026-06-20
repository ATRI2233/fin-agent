/** Stock detail page — K-line chart + trade annotations */

import { useState } from "react";
import {
  Card,
  Spin,
  message,
  Table,
  Tag,
  Button,
  Space,
  Typography,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  DatePicker,
  Row,
  Col,
  Tabs,
} from "antd";
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  PlusOutlined,
  DeleteOutlined,
  ReloadOutlined,
  FundViewOutlined,
} from "@ant-design/icons";
import { useParams, useNavigate } from "react-router-dom";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  CartesianGrid,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import {
  useStockDetail,
  useCreateAnnotation,
  useDeleteAnnotation,
  useImportPrices,
  useCreateStock,
} from "../../../hooks/usePortfolio";
import type {
  ActionType,
  Annotation,
  KlineData,
  PriceHistoryRecord,
  StockDetail,
} from "../../../domain/modules/portfolio";

const { Text } = Typography;

function klineToChart(prices: PriceHistoryRecord[]): KlineData[] {
  return prices.map((p) => ({
    time: p.trade_date,
    open: p.open_price ?? p.close_price,
    high: p.high_price ?? p.close_price,
    low: p.low_price ?? p.close_price,
    close: p.close_price,
    volume: p.volume ?? 0,
  }));
}

function annotationMarkers(
  annotations: Annotation[],
): { time: string; y: number; action: ActionType; annotation: string }[] {
  return annotations.map((a) => ({
    time: a.trade_date,
    y: a.price,
    action: a.action,
    annotation: a.annotation || "",
  }));
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ value: number; payload: KlineData }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div
      style={{
        background: "#1A1A1A",
        border: "1px solid rgba(255,255,255,0.1)",
        borderRadius: 8,
        padding: "8px 12px",
        fontSize: 12,
      }}
    >
      <div style={{ color: "#787878" }}>{d.time}</div>
      <div style={{ color: "#F0F0F0" }}>
        开 {d.open?.toFixed(3)} / 高 {d.high?.toFixed(3)}
      </div>
      <div style={{ color: "#F0F0F0" }}>
        低 {d.low?.toFixed(3)} / 收 {d.close?.toFixed(3)}
      </div>
      {d.volume !== undefined && (
        <div style={{ color: "#787878" }}>成交量 {d.volume?.toLocaleString()}</div>
      )}
    </div>
  );
}

export default function StockDetailPage() {
  const { stockId } = useParams<{ stockId: string }>();
  const navigate = useNavigate();
  const id = Number(stockId);

  // Data hooks
  const { data: detail, isLoading, refetch } = useStockDetail(id);
  const createAnnotationMut = useCreateAnnotation();
  const deleteAnnotationMut = useDeleteAnnotation();
  const importPricesMut = useImportPrices();
  const createStockMut = useCreateStock();

  // Annotation modal
  const [annoModalVisible, setAnnoModalVisible] = useState(false);
  const [annoForm] = Form.useForm();

  // Import price modal
  const [importModalVisible, setImportModalVisible] = useState(false);
  const [importForm] = Form.useForm();

  // Create stock modal
  const [stockModalVisible, setStockModalVisible] = useState(false);
  const [stockForm] = Form.useForm();

  const handleAddAnnotation = async () => {
    try {
      const values = await annoForm.validateFields();
      await createAnnotationMut.mutateAsync({
        ...values,
        trade_date: values.trade_date.format("YYYY-MM-DD"),
      });
      message.success("标注已添加");
      setAnnoModalVisible(false);
      annoForm.resetFields();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error("添加失败");
    }
  };

  const handleDeleteAnnotation = async (annoId: number) => {
    try {
      await deleteAnnotationMut.mutateAsync(annoId);
      message.success("已删除");
    } catch {
      message.error("删除失败");
    }
  };

  const handleImportPrices = async () => {
    try {
      const values = await importForm.validateFields();
      const lines = values.csv.trim().split("\n");
      const records = lines
        .slice(1) // skip header
        .map((line) => {
          const parts = line.split(",").map((s) => s.trim());
          // CSV format: date,open,high,low,close,volume
          return {
            trade_date: parts[0],
            open_price: parts[1] ? Number(parts[1]) : null,
            high_price: parts[2] ? Number(parts[2]) : null,
            low_price: parts[3] ? Number(parts[3]) : null,
            close_price: Number(parts[4]) || 0,
            volume: parts[5] ? Number(parts[5]) : null,
          };
        })
        .filter((r) => r.trade_date && r.close_price);

      const result = await importPricesMut.mutateAsync({ stockId: id, records });
      message.success(`已导入 ${result.imported} 条数据`);
      setImportModalVisible(false);
      importForm.resetFields();
    } catch (e: any) {
      if (e.errorFields) return;
      message.error("导入失败");
    }
  };

  const handleCreateStock = async () => {
    try {
      const values = await stockForm.validateFields();
      const stock = await createStockMut.mutateAsync(values);
      message.success(`股票 ${stock.symbol} 已创建`);
      setStockModalVisible(false);
      stockForm.resetFields();
      // Add as holding with cost
      const holdForm = importForm;
      holdForm.setFieldsValue({ stock_id: stock.id });
      setImportModalVisible(true);
    } catch (e: any) {
      if (e.errorFields) return;
      message.error("创建失败");
    }
  };

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!detail) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 100 }}>
        <Text style={{ color: "#787878" }}>股票不存在</Text>
      </div>
    );
  }

  const { stock, holding, prices, annotations, pnl, latest_price } = detail;
  const chartData = klineToChart(prices);
  const markers = annotationMarkers(annotations);
  const priceMin = chartData.length
    ? Math.min(...chartData.map((d) => d.low)) * 0.98
    : 0;
  const priceMax = chartData.length
    ? Math.max(...chartData.map((d) => d.high)) * 1.02
    : 100;

  const priceColumns = [
    { title: "日期", dataIndex: "trade_date", key: "trade_date", width: 120 },
    {
      title: "开盘",
      dataIndex: "open_price",
      key: "open",
      width: 90,
      align: "right" as const,
      render: (v: number | null) => v?.toFixed(3) ?? "—",
    },
    {
      title: "最高",
      dataIndex: "high_price",
      key: "high",
      width: 90,
      align: "right" as const,
      render: (v: number | null) => v?.toFixed(3) ?? "—",
    },
    {
      title: "最低",
      dataIndex: "low_price",
      key: "low",
      width: 90,
      align: "right" as const,
      render: (v: number | null) => v?.toFixed(3) ?? "—",
    },
    {
      title: "收盘",
      dataIndex: "close_price",
      key: "close",
      width: 90,
      align: "right" as const,
      render: (v: number) => v.toFixed(3),
    },
    {
      title: "成交量",
      dataIndex: "volume",
      key: "volume",
      width: 100,
      align: "right" as const,
      render: (v: number | null) =>
        v != null ? v.toLocaleString() : "—",
    },
  ];

  const annoColumns = [
    {
      title: "日期",
      dataIndex: "trade_date",
      key: "trade_date",
      width: 120,
    },
    {
      title: "方向",
      dataIndex: "action",
      key: "action",
      width: 80,
      render: (a: ActionType) => (
        <Tag color={a === "buy" ? "green" : "red"}>
          {a === "buy" ? "买入" : "卖出"}
        </Tag>
      ),
    },
    {
      title: "价格",
      dataIndex: "price",
      key: "price",
      width: 100,
      align: "right" as const,
      render: (v: number) => `¥${v.toFixed(3)}`,
    },
    {
      title: "数量",
      dataIndex: "quantity",
      key: "quantity",
      width: 80,
      align: "right" as const,
      render: (v: number | null) => v?.toLocaleString() ?? "—",
    },
    {
      title: "备注",
      dataIndex: "annotation",
      key: "annotation",
      render: (v: string | null) => v || "—",
    },
    {
      title: "",
      key: "actions",
      width: 60,
      render: (_: unknown, r: Annotation) => (
        <Button
          type="text"
          danger
          size="small"
          icon={<DeleteOutlined />}
          onClick={() => handleDeleteAnnotation(r.id)}
        />
      ),
    },
  ];

  return (
    <div className="page-container fade-in">
      {/* Header */}
      <div
        style={{
          marginBottom: 24,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">
            <FundViewOutlined style={{ marginRight: 12 }} />
            {stock.symbol}
            {stock.name && (
              <span style={{ fontSize: 16, color: "#787878", fontWeight: 400 }}>
                {" "}
                — {stock.name}
              </span>
            )}
          </h1>
          <p className="page-hero-subtitle">
            {stock.market || "—"} · {stock.currency}
          </p>
        </div>
        <Space size={12}>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="large">
            刷新
          </Button>
          <Button icon={<PlusOutlined />} onClick={() => setImportModalVisible(true)} size="large">
            导入价格
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setAnnoModalVisible(true)}
            size="large"
          >
            添加标注
          </Button>
        </Space>
      </div>

      {/* Holding info + P&L */}
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={8}>
          <Card className="card-spacious">
            <Text style={{ color: "#787878", fontSize: 13 }}>持仓</Text>
            {holding ? (
              <>
                <div style={{ fontSize: 24, color: "#F0F0F0", fontWeight: 600 }}>
                  {holding.quantity.toLocaleString()}
                </div>
                <Text style={{ color: "#787878", fontSize: 12 }}>
                  成本价 ¥{holding.cost_basis.toFixed(3)}
                </Text>
              </>
            ) : (
              <Text style={{ color: "#555" }}>暂无持仓</Text>
            )}
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="card-spacious">
            <Text style={{ color: "#787878", fontSize: 13 }}>最新收盘价</Text>
            <div style={{ fontSize: 24, color: "#F0F0F0", fontWeight: 600 }}>
              {latest_price != null ? `¥${latest_price.toFixed(3)}` : "—"}
            </div>
            <Text style={{ color: "#787878", fontSize: 12 }}>
              {prices.length > 0 ? prices[prices.length - 1].trade_date : ""}
            </Text>
          </Card>
        </Col>
        <Col xs={24} sm={8}>
          <Card className="card-spacious">
            <Text style={{ color: "#787878", fontSize: 13 }}>持仓盈亏</Text>
            {pnl ? (
              <>
                <div
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    color: pnl.pnl_amount >= 0 ? "#5A9E7B" : "#D47070",
                  }}
                >
                  {pnl.pnl_amount >= 0 ? "+" : ""}¥{pnl.pnl_amount.toFixed(2)}
                </div>
                <Text
                  style={{
                    fontSize: 14,
                    color: pnl.pnl_percent >= 0 ? "#5A9E7B" : "#D47070",
                  }}
                >
                  {pnl.pnl_percent >= 0 ? "+" : ""}
                  {pnl.pnl_percent.toFixed(2)}%
                </Text>
              </>
            ) : (
              <Text style={{ color: "#555" }}>—</Text>
            )}
          </Card>
        </Col>
      </Row>

      {/* K-line chart */}
      {chartData.length > 0 ? (
        <Card className="card-spacious" style={{ marginBottom: 24 }}>
          <ResponsiveContainer width="100%" height={340}>
            <LineChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis
                dataKey="time"
                tick={{ fill: "#787878", fontSize: 11 }}
                tickLine={false}
                axisLine={{ stroke: "rgba(255,255,255,0.1)" }}
              />
              <YAxis
                domain={[priceMin, priceMax]}
                tick={{ fill: "#787878", fontSize: 11 }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => v.toFixed(1)}
                width={60}
              />
              <RechartsTooltip content={<CustomTooltip />} />
              {/* Annotation reference lines */}
              {markers.map((m) => (
                <ReferenceLine
                  key={`anno-${m.time}-${m.y}`}
                  x={m.time}
                  y={m.y}
                  stroke={m.action === "buy" ? "#5A9E7B" : "#D47070"}
                  strokeDasharray="3 3"
                  strokeWidth={1}
                />
              ))}
              <Line
                type="monotone"
                dataKey="close"
                stroke="#6B8EC4"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#6B8EC4" }}
              />
            </LineChart>
          </ResponsiveContainer>
          {/* Annotation legend */}
          {markers.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", gap: 16, flexWrap: "wrap" }}>
              {markers.map((m, i) => (
                <Tag
                  key={i}
                  color={m.action === "buy" ? "green" : "red"}
                  icon={m.action === "buy" ? <ArrowUpOutlined /> : <ArrowDownOutlined />}
                >
                  {m.time} ¥{m.y.toFixed(2)}
                  {m.annotation && ` — ${m.annotation}`}
                </Tag>
              ))}
            </div>
          )}
        </Card>
      ) : (
        <Card className="card-spacious" style={{ marginBottom: 24, textAlign: "center", padding: "40px 0" }}>
          <Text style={{ color: "#787878" }}>
            暂无价格数据，请先导入
          </Text>
          <div style={{ marginTop: 12 }}>
            <Button type="primary" onClick={() => setImportModalVisible(true)}>
              导入价格数据
            </Button>
          </div>
        </Card>
      )}

      {/* Price history + Annotations tabs */}
      <Card className="card-spacious">
        <Tabs
          defaultActiveKey="prices"
          items={[
            {
              key: "prices",
              label: "历史价格",
              children: (
                <Table
                  columns={priceColumns}
                  dataSource={prices.map((p) => ({ ...p, key: p.id }))}
                  size="small"
                  pagination={{ pageSize: 20 }}
                  rowKey="id"
                />
              ),
            },
            {
              key: "annotations",
              label: `买卖标注 (${annotations.length})`,
              children: (
                <Table
                  columns={annoColumns}
                  dataSource={annotations.map((a) => ({ ...a, key: a.id }))}
                  size="small"
                  pagination={false}
                  rowKey="id"
                  locale={{ emptyText: "暂无标注" }}
                />
              ),
            },
          ]}
        />
      </Card>

      {/* Annotation Modal */}
      <Modal
        title="添加买卖标注"
        open={annoModalVisible}
        onCancel={() => setAnnoModalVisible(false)}
        onOk={handleAddAnnotation}
        loading={createAnnotationMut.isPending}
        width={420}
        destroyOnClose
      >
        <Form form={annoForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="trade_date"
            label="日期"
            rules={[{ required: true, message: "请选择日期" }]}
          >
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="action" label="方向" rules={[{ required: true }]}>
            <Select placeholder="选择买入或卖出">
              <Select.Option value="buy">买入</Select.Option>
              <Select.Option value="sell">卖出</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item
            name="price"
            label="价格 (元)"
            rules={[{ required: true, message: "请输入价格" }]}
          >
            <InputNumber min={0} precision={3} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="quantity" label="数量 (可选)">
            <InputNumber min={0} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item name="annotation" label="备注 (可选)">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Import Prices Modal */}
      <Modal
        title="导入价格数据 (CSV)"
        open={importModalVisible}
        onCancel={() => setImportModalVisible(false)}
        onOk={handleImportPrices}
        width={600}
        destroyOnClose
      >
        <Form form={importForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="stock_id"
            label="股票 ID"
            rules={[{ required: true, message: "请输入股票 ID" }]}
            initialValue={id}
          >
            <InputNumber min={1} style={{ width: "100%" }} disabled />
          </Form.Item>
          <Form.Item
            name="csv"
            label="CSV 内容"
            rules={[{ required: true, message: "请粘贴 CSV 数据" }]}
          >
            <Input.TextArea
              rows={10}
              placeholder={`格式: date,open,high,low,close,volume\n2024-01-01,10.5,10.8,10.2,10.6,1000000\n2024-01-02,10.6,10.9,10.4,10.8,1200000`}
              style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 12 }}
            />
          </Form.Item>
          <Text style={{ color: "#787878", fontSize: 12 }}>
            注意：第一行是表头（date,open,high,low,close,volume），从第二行开始是数据。
          </Text>
          <div style={{ marginTop: 12 }}>
            <Button type="link" onClick={() => { setImportModalVisible(false); setStockModalVisible(true); }}>
              股票不存在？去创建
            </Button>
          </div>
        </Form>
      </Modal>

      {/* Create Stock Modal */}
      <Modal
        title="创建股票"
        open={stockModalVisible}
        onCancel={() => setStockModalVisible(false)}
        onOk={handleCreateStock}
        width={420}
        destroyOnClose
      >
        <Form form={stockForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item name="symbol" label="股票代码" rules={[{ required: true }]}>
            <Input placeholder="如 000001.SZ 或 AAPL" />
          </Form.Item>
          <Form.Item name="name" label="名称">
            <Input placeholder="如 平安银行" />
          </Form.Item>
          <Form.Item name="market" label="市场">
            <Select placeholder="选择市场">
              <Select.Option value="A股">A股</Select.Option>
              <Select.Option value="美股">美股</Select.Option>
              <Select.Option value="港股">港股</Select.Option>
            </Select>
          </Form.Item>
          <Form.Item name="currency" label="货币" initialValue="CNY">
            <Select>
              <Select.Option value="CNY">CNY (人民币)</Select.Option>
              <Select.Option value="USD">USD (美元)</Select.Option>
              <Select.Option value="HKD">HKD (港币)</Select.Option>
            </Select>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
