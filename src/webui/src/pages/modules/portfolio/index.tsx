/** Portfolio module — main holdings overview page */

import { useState } from "react";
import {
  Card,
  Table,
  Tag,
  Space,
  Typography,
  Spin,
  Button,
  message,
  Empty,
  Modal,
  Form,
  Input,
  InputNumber,
  Select,
  Row,
  Col,
} from "antd";
import {
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  ReloadOutlined,
  FolderOutlined,
  RiseOutlined,
  FallOutlined,
} from "@ant-design/icons";
import { useNavigate } from "react-router-dom";

import {
  useCreateHolding,
  useDeleteHolding,
  useOverview,
  useStocks,
  useUpdateHolding,
} from "../../hooks/usePortfolio";
import type {
  Holding,
  HoldingCreate,
  HoldingUpdate,
  Overview,
  Stock,
} from "../../domain/modules/portfolio";

const { Text } = Typography;

function pnlColor(amount: number): string {
  if (amount > 0) return "#5A9E7B";
  if (amount < 0) return "#D47070";
  return "#787878";
}

function PnlTag({ amount, percent }: { amount: number; percent: number }) {
  const color = pnlColor(amount);
  const sign = amount >= 0 ? "+" : "";
  return (
    <Text style={{ color, fontSize: 13 }}>
      {amount === 0 && percent === 0 ? (
        "—"
      ) : (
        <>
          {amount > 0 ? <RiseOutlined /> : amount < 0 ? <FallOutlined /> : null}
          {sign}
          {amount.toFixed(2)} ({sign}
          {percent.toFixed(2)}%)
        </>
      )}
    </Text>
  );
}

export default function PortfolioIndexPage() {
  const navigate = useNavigate();

  // Data hooks
  const { data: overview, isLoading, refetch } = useOverview();
  const [stockSearch, setStockSearch] = useState("");
  const { data: stocks = [] } = useStocks(stockSearch);

  // Mutations
  const createMut = useCreateHolding();
  const updateMut = useUpdateHolding();
  const deleteMut = useDeleteHolding();

  // Create/edit modal
  const [modalVisible, setModalVisible] = useState(false);
  const [editingHolding, setEditingHolding] = useState<Holding | null>(null);
  const [form] = Form.useForm();

  const openCreate = () => {
    setEditingHolding(null);
    form.resetFields();
    setModalVisible(true);
  };

  const openEdit = (h: Holding) => {
    setEditingHolding(h);
    form.setFieldsValue({
      stock_id: h.stock_id,
      quantity: h.quantity,
      cost_basis: h.cost_basis,
      notes: h.notes,
    });
    setModalVisible(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      if (editingHolding) {
        await updateMut.mutateAsync({
          holdingId: editingHolding.id,
          data: values as Partial<HoldingUpdate>,
        });
        message.success("已更新");
      } else {
        await createMut.mutateAsync(values as HoldingCreate);
        message.success("已添加");
      }
      setModalVisible(false);
      // No need to refetch overview — useCreateHolding/useUpdateHolding invalidate the keys
    } catch (e: any) {
      if (e.errorFields) return;
      message.error("保存失败");
    }
  };

  const handleDelete = async (id: number) => {
    try {
      await deleteMut.mutateAsync(id);
      message.success("已删除");
    } catch {
      message.error("删除失败");
    }
  };

  const columns = [
    {
      title: "股票",
      key: "stock",
      render: (_: unknown, r: Holding) => (
        <div>
          <Text style={{ color: "#F0F0F0", fontWeight: 600 }}>{r.symbol}</Text>
          {r.name && (
            <div>
              <Text style={{ color: "#787878", fontSize: 12 }}>{r.name}</Text>
            </div>
          )}
        </div>
      ),
    },
    {
      title: "持股数量",
      dataIndex: "quantity",
      key: "quantity",
      width: 120,
      align: "right" as const,
      render: (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 4 }),
    },
    {
      title: "成本价",
      dataIndex: "cost_basis",
      key: "cost_basis",
      width: 100,
      align: "right" as const,
      render: (v: number) => `¥${v.toFixed(3)}`,
    },
    {
      title: "总成本",
      key: "total_cost",
      width: 120,
      align: "right" as const,
      render: (_: unknown, r: Holding) => {
        const cost = r.quantity * r.cost_basis;
        return `¥${cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
      },
    },
    {
      title: "备注",
      dataIndex: "notes",
      key: "notes",
      render: (v: string | null) => v || "—",
    },
    {
      title: "操作",
      key: "actions",
      width: 120,
      render: (_: unknown, r: Holding) => (
        <Space size={4}>
          <Button
            type="text"
            icon={<EditOutlined />}
            onClick={() => openEdit(r)}
            style={{ color: "#B0B0B0" }}
          />
          <Button
            type="text"
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(r.id)}
            danger
          />
        </Space>
      ),
    },
  ];

  if (isLoading) {
    return (
      <div style={{ display: "flex", justifyContent: "center", paddingTop: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  const holdings = overview?.holdings ?? [];

  return (
    <div className="page-container fade-in">
      {/* Header */}
      <div
        style={{
          marginBottom: 32,
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-end",
        }}
      >
        <div className="page-hero" style={{ marginBottom: 0 }}>
          <h1 className="page-hero-title">
            <FolderOutlined style={{ marginRight: 12 }} />
            持仓管理
          </h1>
          <p className="page-hero-subtitle">当前持仓、市值与盈亏统计</p>
        </div>
        <Space size={12}>
          <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="large" />
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate} size="large">
            添加持仓
          </Button>
        </Space>
      </div>

      {/* Stat cards */}
      {overview && (
        <Row gutter={[16, 16]} style={{ marginBottom: 28 }}>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-1">
              <div className="stat-card-icon">
                <FolderOutlined style={{ color: "#6B8EC4" }} />
              </div>
              <div className="stat-card-number">{overview.total_holdings}</div>
              <div className="stat-card-label">持仓数</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-2">
              <div className="stat-card-icon">
                <FolderOutlined style={{ color: "#D4A85A" }} />
              </div>
              <div className="stat-card-number">
                ¥{overview.total_cost.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="stat-card-label">总成本</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-3">
              <div className="stat-card-icon">
                <FolderOutlined style={{ color: "#5A9E7B" }} />
              </div>
              <div className="stat-card-number">
                ¥{overview.total_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
              <div className="stat-card-label">总市值</div>
            </div>
          </Col>
          <Col xs={12} sm={6}>
            <div className="stat-card fade-in fade-in-4">
              <div
                className="stat-card-number"
                style={{ color: pnlColor(overview.total_pnl_amount), fontSize: 28 }}
              >
                {overview.total_pnl_amount >= 0 ? "+" : ""}
                {overview.total_pnl_amount.toFixed(2)}
              </div>
              <div className="stat-card-number" style={{ fontSize: 14, color: "#787878" }}>
                {overview.total_pnl_percent >= 0 ? "+" : ""}
                {overview.total_pnl_percent.toFixed(2)}%
              </div>
              <div className="stat-card-label">总盈亏</div>
            </div>
          </Col>
        </Row>
      )}

      {/* Holdings table */}
      <Card className="card-spacious">
        {holdings.length === 0 ? (
          <Empty
            description={
              <span style={{ color: "#787878" }}>
                暂无持仓，点击上方按钮添加
              </span>
            }
          />
        ) : (
          <Table
            columns={columns}
            dataSource={holdings}
            rowKey="id"
            size="middle"
            pagination={{ pageSize: 20 }}
            onRow={(r) => ({
              style: { cursor: "pointer" },
              onClick: () => navigate(`/modules/portfolio/${r.stock_id}`),
            })}
          />
        )}
      </Card>

      {/* Create / Edit Modal */}
      <Modal
        title={editingHolding ? "编辑持仓" : "添加持仓"}
        open={modalVisible}
        onCancel={() => setModalVisible(false)}
        onOk={handleSave}
        width={500}
        destroyOnClose
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          {!editingHolding && (
            <Form.Item
              name="stock_id"
              label="股票"
              rules={[{ required: true, message: "请选择股票" }]}
            >
              <Select
                showSearch
                placeholder="搜索股票代码或名称"
                filterOption={false}
                onSearch={(v: string) => setStockSearch(v)}
                onFocus={() => setStockSearch("")}
              >
                {stocks.map((s) => (
                  <Select.Option key={s.id} value={s.id}>
                    {s.symbol} — {s.name || s.market || ""}
                  </Select.Option>
                ))}
              </Select>
            </Form.Item>
          )}
          <Form.Item
            name="quantity"
            label="持股数量"
            rules={[{ required: true, message: "请输入数量" }]}
          >
            <InputNumber min={0} style={{ width: "100%" }} placeholder="e.g. 1000" />
          </Form.Item>
          <Form.Item
            name="cost_basis"
            label="成本价 (元)"
            rules={[{ required: true, message: "请输入成本价" }]}
          >
            <InputNumber min={0} precision={3} style={{ width: "100%" }} placeholder="e.g. 12.500" />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={2} placeholder="可选备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}