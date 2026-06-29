-- 薪福通审批记录数据库
-- 路径: /Users/wuliang/.hermes/data/cmb_approvals.db

CREATE TABLE IF NOT EXISTS approvals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bill_id TEXT NOT NULL UNIQUE,
    bill_type TEXT NOT NULL,              -- 合同用印/员工日常报销单/差旅报销单/供应商结算单/投流费用申请单等
    applicant_name TEXT NOT NULL,         -- 申请人
    applicant_id TEXT,                    -- 申请人工号
    amount REAL,                          -- 金额 CNY
    subject TEXT,                         -- 事由
    department TEXT,                      -- 承担部门
    project TEXT,                         -- 关联项目
    company TEXT DEFAULT '厦门小题旅行科技有限公司',
    approved_at TEXT NOT NULL,            -- 审批时间 ISO8601
    approved_by TEXT DEFAULT '吴亮',
    action TEXT NOT NULL DEFAULT 'agree', -- agree / reject
    remark TEXT,                          -- 审批意见
    source TEXT DEFAULT 'cmb-xft',        -- 来源系统
    sync_dingtalk_todo INTEGER DEFAULT 0, -- 是否已同步钉钉待办
    created_at TEXT DEFAULT (datetime('now', 'localtime'))
);

CREATE INDEX IF NOT EXISTS idx_approvals_bill_id ON approvals(bill_id);
CREATE INDEX IF NOT EXISTS idx_approvals_applicant ON approvals(applicant_name);
CREATE INDEX IF NOT EXISTS idx_approvals_approved_at ON approvals(approved_at);
CREATE INDEX IF NOT EXISTS idx_approvals_type ON approvals(bill_type);
