import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  PAYMENT_METHOD_NONE_VALUE,
  PAYMENT_METHOD_OTHER_VALUE,
  PaymentMethodSelector,
} from "@/components/payment-method-selector";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

const QUICK_SERVICE_OPTIONS = [
  "Vehicle Wash",
  "Full Wash / Detailing",
  "Oil Change",
  "Filter Change",
  "General Checkup",
  "Inspection",
  "Battery Check",
  "Brake Check",
  "Tyre Check",
  "Wheel Alignment",
  "Wheel Balancing",
  "Diagnostic Scan",
  "Minor Electrical Repair",
  "Minor Mechanical Repair",
  "Other",
] as const;

const QUICK_SERVICE_OTHER = "Other";
const QUICK_SERVICE_DEFAULT_OPTIONS = QUICK_SERVICE_OPTIONS.filter(
  (option) => option !== QUICK_SERVICE_OTHER
);
const QUICK_SERVICE_CUSTOM_STORAGE_KEY = "yasuki.quickService.customServices";
const QUICK_SERVICE_DRAFT_STORAGE_KEY = "yasuki.quickService.draft";
const QUICK_SERVICE_PAYMENT_STATUSES = ["unpaid", "partial", "paid"] as const;
const CUSTOMERS_QUERY_KEY = ["customers"];
const QUICK_SERVICE_VEHICLES_QUERY_KEY = ["vehicles"];
const QUICK_SERVICE_INVENTORY_QUERY_KEY = ["inventory"];
const QUICK_SERVICE_CUSTOM_SERVICES_QUERY_KEY = ["quickServiceCustomServices"];

type QuickServiceSelectedService = {
  key: string;
  name: string;
  charge: string;
};

type QuickServiceInventoryLine = {
  inventoryItemId: number;
  quantity: string;
  unitPrice: string;
};

type QuickServiceManualLine = {
  key: string;
  name: string;
  quantity: number;
  unitPrice: number;
};

type QuickServiceDraft = {
  version: 1;
  search: string;
  customerId: number | null;
  vehicleId: number | null;
  serviceType: string;
  customService: string;
  selectedServices: QuickServiceSelectedService[];
  notes: string;
  paymentStatus: (typeof QUICK_SERVICE_PAYMENT_STATUSES)[number];
  paymentMethod: string;
  customPaymentMethod: string;
  inventorySearch: string;
  inventoryLines: QuickServiceInventoryLine[];
  manualLines: QuickServiceManualLine[];
};

const normalizeQuickServiceName = (value: string) => value.trim().replace(/\s+/g, " ");

type QuickServiceCustomServiceRecord = {
  id: number;
  name: string;
};

/** One-time legacy localStorage read for migration to the backend DB. */
const loadLegacyLocalCustomQuickServices = (): string[] => {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(QUICK_SERVICE_CUSTOM_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const defaults = new Set(
      QUICK_SERVICE_DEFAULT_OPTIONS.map((option) => option.toLowerCase())
    );
    const seen = new Set<string>();
    const custom: string[] = [];
    for (const entry of parsed) {
      if (typeof entry !== "string") continue;
      const name = normalizeQuickServiceName(entry);
      if (!name) continue;
      const key = name.toLowerCase();
      if (key === QUICK_SERVICE_OTHER.toLowerCase()) continue;
      if (defaults.has(key) || seen.has(key)) continue;
      seen.add(key);
      custom.push(name);
    }
    return custom;
  } catch {
    return [];
  }
};

const clearLegacyLocalCustomQuickServices = () => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(QUICK_SERVICE_CUSTOM_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

const hasLegacyLocalCustomQuickServicesKey = () => {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(QUICK_SERVICE_CUSTOM_STORAGE_KEY) != null;
  } catch {
    return false;
  }
};

const isQuickServicePaymentStatus = (
  value: unknown
): value is (typeof QUICK_SERVICE_PAYMENT_STATUSES)[number] =>
  typeof value === "string" &&
  (QUICK_SERVICE_PAYMENT_STATUSES as readonly string[]).includes(value);

const loadQuickServiceDraft = (): QuickServiceDraft | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(QUICK_SERVICE_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<QuickServiceDraft> | null;
    if (!parsed || parsed.version !== 1 || typeof parsed !== "object") return null;

    const selectedServices = Array.isArray(parsed.selectedServices)
      ? parsed.selectedServices
          .filter(
            (entry): entry is QuickServiceSelectedService =>
              !!entry &&
              typeof entry === "object" &&
              typeof entry.key === "string" &&
              typeof entry.name === "string" &&
              typeof entry.charge === "string"
          )
          .map((entry) => ({
            key: entry.key,
            name: entry.name,
            charge: entry.charge,
          }))
      : [];

    const inventoryLines = Array.isArray(parsed.inventoryLines)
      ? parsed.inventoryLines
          .filter(
            (entry): entry is QuickServiceInventoryLine =>
              !!entry &&
              typeof entry === "object" &&
              Number.isFinite(Number(entry.inventoryItemId)) &&
              typeof entry.quantity === "string" &&
              typeof entry.unitPrice === "string"
          )
          .map((entry) => ({
            inventoryItemId: Number(entry.inventoryItemId),
            quantity: entry.quantity,
            unitPrice: entry.unitPrice,
          }))
      : [];

    const manualLines = Array.isArray(parsed.manualLines)
      ? parsed.manualLines
          .filter(
            (entry): entry is QuickServiceManualLine =>
              !!entry &&
              typeof entry === "object" &&
              typeof entry.key === "string" &&
              typeof entry.name === "string" &&
              Number.isFinite(Number(entry.quantity)) &&
              Number.isFinite(Number(entry.unitPrice))
          )
          .map((entry) => ({
            key: entry.key,
            name: entry.name,
            quantity: Number(entry.quantity),
            unitPrice: Number(entry.unitPrice),
          }))
      : [];

    return {
      version: 1,
      search: typeof parsed.search === "string" ? parsed.search : "",
      customerId:
        parsed.customerId == null
          ? null
          : Number.isFinite(Number(parsed.customerId))
            ? Number(parsed.customerId)
            : null,
      vehicleId:
        parsed.vehicleId == null
          ? null
          : Number.isFinite(Number(parsed.vehicleId))
            ? Number(parsed.vehicleId)
            : null,
      serviceType: typeof parsed.serviceType === "string" ? parsed.serviceType : "",
      customService: typeof parsed.customService === "string" ? parsed.customService : "",
      selectedServices,
      notes: typeof parsed.notes === "string" ? parsed.notes : "",
      paymentStatus: isQuickServicePaymentStatus(parsed.paymentStatus)
        ? parsed.paymentStatus
        : "unpaid",
      paymentMethod: typeof parsed.paymentMethod === "string" ? parsed.paymentMethod : "Cash",
      customPaymentMethod:
        typeof parsed.customPaymentMethod === "string" ? parsed.customPaymentMethod : "",
      inventorySearch: typeof parsed.inventorySearch === "string" ? parsed.inventorySearch : "",
      inventoryLines,
      manualLines,
    };
  } catch {
    return null;
  }
};

const saveQuickServiceDraft = (draft: QuickServiceDraft) => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(QUICK_SERVICE_DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Ignore quota / private-mode write failures.
  }
};

const clearQuickServiceDraft = () => {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(QUICK_SERVICE_DRAFT_STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
};

const isQuickServiceDraftEmpty = (draft: QuickServiceDraft) =>
  !draft.search.trim() &&
  draft.customerId == null &&
  draft.vehicleId == null &&
  !draft.serviceType.trim() &&
  !draft.customService.trim() &&
  draft.selectedServices.length === 0 &&
  !draft.notes.trim() &&
  draft.paymentStatus === "unpaid" &&
  draft.paymentMethod === "Cash" &&
  !draft.customPaymentMethod.trim() &&
  !draft.inventorySearch.trim() &&
  draft.inventoryLines.length === 0 &&
  draft.manualLines.length === 0;

const persistQuickServiceDraft = (draft: QuickServiceDraft) => {
  if (isQuickServiceDraftEmpty(draft)) {
    clearQuickServiceDraft();
    return;
  }
  saveQuickServiceDraft(draft);
};

type Customer = {
  id: number;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
};

type Vehicle = {
  id: number;
  customer_id: number;
  make: string | null;
  model: string | null;
  year: string | null;
  license_plate: string | null;
  archived?: number;
};

type CreateCustomerPayload = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  license_plate?: string;
  make?: string;
  model?: string;
  year?: string;
};

type CreatedCustomerResponse = Customer & {
  vehicle?: {
    id: number;
    customer_id: number;
    make: string | null;
    model: string | null;
    year: string | null;
    license_plate: string | null;
  };
};

type QuickServiceInventoryItem = {
  id: number;
  name: string;
  description: string | null;
  type: "consumable" | "non-consumable" | "bulk";
  unit: string | null;
  quantity: number;
  reorder_level?: number | null;
  unit_cost?: number | null;
  selling_price?: number | null;
  genuine_or_non_genuine?: "genuine" | "non-genuine" | null;
};

type QuickServiceSupplier = {
  id: number;
  name: string;
};

type QuickServicePurchaseResult = {
  id: number;
  item_name: string;
  quantity: number;
  supplier_name: string | null;
};

type QuickServiceStockStatus = "in-stock" | "low-stock" | "out-of-stock";

const quickServiceInventoryTypeLabel = (type: string) => {
  if (type === "non-consumable") return "Non-Consumable";
  if (type === "bulk") return "Bulk";
  if (type === "consumable") return "Consumable";
  return type;
};

const quickServiceGenuineLabel = (value: string | null | undefined) => {
  if (value === "genuine") return "Genuine";
  if (value === "non-genuine") return "Non Genuine";
  return null;
};

const formatQuickServiceStock = (quantity: number, unit: string | null | undefined) => {
  const amount = Number(quantity).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const unitLabel = unit?.trim();
  return unitLabel ? `${amount} ${unitLabel}` : amount;
};

const QUICK_SERVICE_STOCK_STATUS_RANK: Record<QuickServiceStockStatus, number> = {
  "in-stock": 0,
  "low-stock": 1,
  "out-of-stock": 2,
};

const QUICK_SERVICE_STOCK_STATUS_LABEL: Record<QuickServiceStockStatus, string> = {
  "in-stock": "In Stock",
  "low-stock": "Low Stock",
  "out-of-stock": "Out of Stock",
};

const quickServiceStockStatusBadgeClass: Record<QuickServiceStockStatus, string> = {
  "in-stock":
    "h-5 rounded-full border-transparent bg-success px-1.5 py-0 text-[10px] font-medium leading-none text-success-foreground hover:bg-success",
  "low-stock":
    "h-5 rounded-full border-transparent bg-warning px-1.5 py-0 text-[10px] font-medium leading-none text-warning-foreground hover:bg-warning",
  "out-of-stock":
    "h-5 rounded-full border-transparent bg-destructive px-1.5 py-0 text-[10px] font-medium leading-none text-destructive-foreground hover:bg-destructive",
};

const quickServiceSectionLabelClass = "text-sm font-semibold tracking-tight text-foreground";
const quickServiceSectionCardClass =
  "space-y-3 rounded-lg border border-border/80 bg-card p-4 shadow-sm";
const quickServicePrimaryButtonClass =
  "rounded-md bg-primary shadow-sm hover:bg-primary/90 focus-visible:ring-primary/40";

const quickServiceStockStatus = (
  item: Pick<QuickServiceInventoryItem, "quantity" | "reorder_level">
): QuickServiceStockStatus => {
  const quantity = Number(item.quantity);
  const available = Number.isFinite(quantity) ? quantity : 0;
  const reorderRaw = Number(item.reorder_level ?? 0);
  const reorderLevel = Number.isFinite(reorderRaw) ? reorderRaw : 0;
  if (available <= 0) return "out-of-stock";
  if (available <= reorderLevel) return "low-stock";
  return "in-stock";
};

const quickServiceLineQuantityIssue = (item: QuickServiceInventoryItem, quantityRaw: string) => {
  const quantity = Number(quantityRaw);
  if (!quantityRaw.trim() || !Number.isFinite(quantity) || quantity <= 0) {
    return "Quantity must be greater than 0.";
  }
  // Stock check is type-based (consumable + bulk). Unit label is display-only.
  if ((item.type === "consumable" || item.type === "bulk") && quantity > Number(item.quantity)) {
    return `Only ${formatQuickServiceStock(Number(item.quantity), item.unit)} available.`;
  }
  return null;
};

const quickServiceLineTotal = (quantityRaw: string, unitPriceRaw: string) => {
  const quantity = Number(quantityRaw);
  const unitPrice = unitPriceRaw.trim() === "" ? 0 : Number(unitPriceRaw);
  if (!Number.isFinite(quantity) || quantity < 0 || !Number.isFinite(unitPrice) || unitPrice < 0) return 0;
  return quantity * unitPrice;
};

const quickServiceLinePriceIssue = (unitPriceRaw: string) => {
  if (unitPriceRaw.trim() === "") {
    return "Invoice price is required.";
  }
  const unitPrice = Number(unitPriceRaw);
  if (!Number.isFinite(unitPrice) || unitPrice < 0) {
    return "Invoice price must be 0 or more.";
  }
  return null;
};

const compactSearchValue = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/[\s-]+/g, "");

type QuickServiceSearchKind = "empty" | "phone" | "registration" | "name";

/** Simple local heuristic for Quick Service search autofill. */
const classifyQuickServiceSearchText = (raw: string): QuickServiceSearchKind => {
  const text = raw.trim();
  if (!text) return "empty";

  const phoneCompact = text.replace(/[\s()-]/g, "");
  if (/^\+?\d{7,15}$/.test(phoneCompact)) return "phone";

  const plateCompact = text.replace(/\s+/g, "");
  const looksLikePlate =
    /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)+$/.test(plateCompact) ||
    (/[A-Za-z]/.test(plateCompact) &&
      /\d/.test(plateCompact) &&
      /^[A-Za-z0-9-]+$/.test(plateCompact));
  if (looksLikePlate) return "registration";

  return "name";
};

const formatQuickServiceVehicleName = (vehicle: Vehicle) => {
  const name = [vehicle.make, vehicle.model].filter((part) => part && part.trim()).join(" ");
  return name || null;
};

const formatQuickServiceCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR" }).format(value);

const QuickService = () => {
  const [initialDraft] = useState(() => loadQuickServiceDraft());
  const [quickServiceSearch, setQuickServiceSearch] = useState(() => initialDraft?.search ?? "");
  const [quickServiceResultsOpen, setQuickServiceResultsOpen] = useState(false);
  const [quickServiceCustomerId, setQuickServiceCustomerId] = useState<number | null>(
    () => initialDraft?.customerId ?? null
  );
  const [quickServiceVehicleId, setQuickServiceVehicleId] = useState<number | null>(
    () => initialDraft?.vehicleId ?? null
  );
  const quickServiceSearchRef = useRef<HTMLInputElement>(null);
  const [quickServiceType, setQuickServiceType] = useState(() => initialDraft?.serviceType ?? "");
  const [quickServiceCustomService, setQuickServiceCustomService] = useState(
    () => initialDraft?.customService ?? ""
  );
  const [quickServiceSelectedServices, setQuickServiceSelectedServices] = useState<
    QuickServiceSelectedService[]
  >(() => initialDraft?.selectedServices ?? []);
  const quickServiceSelectedKeyRef = useRef(0);
  const [quickServicePickerKey, setQuickServicePickerKey] = useState(0);
  const [quickServiceNotes, setQuickServiceNotes] = useState(() => initialDraft?.notes ?? "");
  const [quickServicePaymentStatus, setQuickServicePaymentStatus] = useState<
    (typeof QUICK_SERVICE_PAYMENT_STATUSES)[number]
  >(() => initialDraft?.paymentStatus ?? "unpaid");
  const [quickServicePaymentMethod, setQuickServicePaymentMethod] = useState(
    () => initialDraft?.paymentMethod ?? "Cash"
  );
  const [quickServiceCustomPaymentMethod, setQuickServiceCustomPaymentMethod] = useState(
    () => initialDraft?.customPaymentMethod ?? ""
  );
  const [quickServiceInventorySearch, setQuickServiceInventorySearch] = useState(
    () => initialDraft?.inventorySearch ?? ""
  );
  const [quickServiceInventoryResultsOpen, setQuickServiceInventoryResultsOpen] = useState(false);
  const [quickServiceInventoryLines, setQuickServiceInventoryLines] = useState<QuickServiceInventoryLine[]>(
    () => initialDraft?.inventoryLines ?? []
  );
  const [quickServiceManualLines, setQuickServiceManualLines] = useState<QuickServiceManualLine[]>(
    () => initialDraft?.manualLines ?? []
  );
  const [quickServiceManualOpen, setQuickServiceManualOpen] = useState(false);
  const [quickServiceManualName, setQuickServiceManualName] = useState("");
  const [quickServiceManualQuantity, setQuickServiceManualQuantity] = useState("1");
  const [quickServiceManualPrice, setQuickServiceManualPrice] = useState("");
  const quickServiceManualKeyRef = useRef(0);
  const [addStockItem, setAddStockItem] = useState<QuickServiceInventoryItem | null>(null);
  const [addStockQuantity, setAddStockQuantity] = useState("");
  const [addStockUnitCost, setAddStockUnitCost] = useState("");
  const [addStockSupplierId, setAddStockSupplierId] = useState("");
  const [addStockNotes, setAddStockNotes] = useState("");
  const [addStockUpdateInventoryCost, setAddStockUpdateInventoryCost] = useState(true);
  const [quickServiceCreateOpen, setQuickServiceCreateOpen] = useState(false);
  const [quickServiceNewName, setQuickServiceNewName] = useState("");
  const [quickServiceNewPhone, setQuickServiceNewPhone] = useState("");
  const [quickServiceNewEmail, setQuickServiceNewEmail] = useState("");
  const [quickServiceNewAddress, setQuickServiceNewAddress] = useState("");
  const [quickServiceNewPlate, setQuickServiceNewPlate] = useState("");
  const [quickServiceNewMake, setQuickServiceNewMake] = useState("");
  const [quickServiceNewModel, setQuickServiceNewModel] = useState("");
  const [quickServiceNewYear, setQuickServiceNewYear] = useState("");
  const [quickServiceAddVehicleOpen, setQuickServiceAddVehicleOpen] = useState(false);
  const [quickServiceAddVehicleCustomerId, setQuickServiceAddVehicleCustomerId] = useState<number | null>(null);
  const [quickServiceAddVehicleCustomerSearch, setQuickServiceAddVehicleCustomerSearch] = useState("");
  const [quickServiceExistingPlate, setQuickServiceExistingPlate] = useState("");
  const [quickServiceExistingMake, setQuickServiceExistingMake] = useState("");
  const [quickServiceExistingModel, setQuickServiceExistingModel] = useState("");
  const [quickServiceExistingYear, setQuickServiceExistingYear] = useState("");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  useEffect(() => {
    const maxServiceKey = (initialDraft?.selectedServices ?? []).reduce((max, service) => {
      const match = /^svc-(\d+)$/.exec(service.key);
      const value = match ? Number(match[1]) : 0;
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);
    quickServiceSelectedKeyRef.current = maxServiceKey;

    const maxManualKey = (initialDraft?.manualLines ?? []).reduce((max, line) => {
      const match = /^manual-(\d+)$/.exec(line.key);
      const value = match ? Number(match[1]) : 0;
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);
    quickServiceManualKeyRef.current = maxManualKey;
  }, [initialDraft]);

  useEffect(() => {
    persistQuickServiceDraft({
      version: 1,
      search: quickServiceSearch,
      customerId: quickServiceCustomerId,
      vehicleId: quickServiceVehicleId,
      serviceType: quickServiceType,
      customService: quickServiceCustomService,
      selectedServices: quickServiceSelectedServices,
      notes: quickServiceNotes,
      paymentStatus: quickServicePaymentStatus,
      paymentMethod: quickServicePaymentMethod,
      customPaymentMethod: quickServiceCustomPaymentMethod,
      inventorySearch: quickServiceInventorySearch,
      inventoryLines: quickServiceInventoryLines,
      manualLines: quickServiceManualLines,
    });
  }, [
    quickServiceSearch,
    quickServiceCustomerId,
    quickServiceVehicleId,
    quickServiceType,
    quickServiceCustomService,
    quickServiceSelectedServices,
    quickServiceNotes,
    quickServicePaymentStatus,
    quickServicePaymentMethod,
    quickServiceCustomPaymentMethod,
    quickServiceInventorySearch,
    quickServiceInventoryLines,
    quickServiceManualLines,
  ]);

  const {
    data: customersData,
    isLoading: customersLoading,
    isError: customersError,
  } = useQuery<Customer[], Error>({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: () => apiFetch<Customer[]>("/customers"),
  });

  const customers = customersData ?? [];

  const {
    data: quickServiceVehiclesData,
    isLoading: quickServiceVehiclesLoading,
    isError: quickServiceVehiclesError,
  } = useQuery<Vehicle[], Error>({
    queryKey: QUICK_SERVICE_VEHICLES_QUERY_KEY,
    queryFn: () => apiFetch<Vehicle[]>("/vehicles"),
  });

  const {
    data: quickServiceInventoryData,
    isLoading: quickServiceInventoryLoading,
    isError: quickServiceInventoryError,
  } = useQuery<QuickServiceInventoryItem[], Error>({
    queryKey: QUICK_SERVICE_INVENTORY_QUERY_KEY,
    queryFn: () => apiFetch<QuickServiceInventoryItem[]>("/inventory"),
  });

  const {
    data: quickServiceCustomServicesData,
  } = useQuery<QuickServiceCustomServiceRecord[], Error>({
    queryKey: QUICK_SERVICE_CUSTOM_SERVICES_QUERY_KEY,
    queryFn: () => apiFetch<QuickServiceCustomServiceRecord[]>("/jobs/quick-service/services"),
  });

  const createQuickServiceCustomServiceMutation = useMutation<
    QuickServiceCustomServiceRecord,
    Error,
    { name: string }
  >({
    mutationFn: (payload) =>
      apiFetch<QuickServiceCustomServiceRecord>("/jobs/quick-service/services", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUICK_SERVICE_CUSTOM_SERVICES_QUERY_KEY });
    },
  });

  useEffect(() => {
    let cancelled = false;

    const migrateLegacyCustomServices = async () => {
      if (!hasLegacyLocalCustomQuickServicesKey()) return;
      const legacy = loadLegacyLocalCustomQuickServices();
      if (legacy.length === 0) {
        clearLegacyLocalCustomQuickServices();
        return;
      }

      try {
        for (const name of legacy) {
          if (cancelled) return;
          await apiFetch<QuickServiceCustomServiceRecord>("/jobs/quick-service/services", {
            method: "POST",
            body: JSON.stringify({ name }),
          });
        }
        if (cancelled) return;
        clearLegacyLocalCustomQuickServices();
        queryClient.invalidateQueries({ queryKey: QUICK_SERVICE_CUSTOM_SERVICES_QUERY_KEY });
      } catch {
        // Keep localStorage until a full successful migration.
      }
    };

    void migrateLegacyCustomServices();
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const quickServiceDropdownOptions = useMemo(() => {
    const defaults = [...QUICK_SERVICE_DEFAULT_OPTIONS];
    const defaultKeys = new Set(defaults.map((option) => option.toLowerCase()));
    const seen = new Set(defaultKeys);
    const custom = (quickServiceCustomServicesData ?? [])
      .map((entry) => normalizeQuickServiceName(entry.name))
      .filter((name) => {
        if (!name) return false;
        const key = name.toLowerCase();
        if (key === QUICK_SERVICE_OTHER.toLowerCase()) return false;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));
    return [...defaults, ...custom, QUICK_SERVICE_OTHER];
  }, [quickServiceCustomServicesData]);

  const quickServiceLabourAmount = useMemo(() => {
    return quickServiceSelectedServices.reduce((sum, service) => {
      const parsed = Number(service.charge);
      if (!Number.isFinite(parsed) || parsed < 0) return sum;
      return sum + parsed;
    }, 0);
  }, [quickServiceSelectedServices]);

  const quickServiceHasInvalidServiceCharge = quickServiceSelectedServices.some((service) => {
    const raw = service.charge.trim();
    if (!raw) return true;
    const parsed = Number(raw);
    return !Number.isFinite(parsed) || parsed < 0;
  });

  const quickServiceInventoryQuery = quickServiceInventorySearch.trim().toLowerCase();
  const quickServiceInvoiceInventory = useMemo(() => {
    return (quickServiceInventoryData ?? []).filter(
      (item) => item.type === "consumable" || item.type === "bulk"
    );
  }, [quickServiceInventoryData]);

  const quickServiceInventoryMatches = useMemo(() => {
    const items = quickServiceInvoiceInventory;
    const visibleItems = quickServiceInventoryQuery
      ? items.filter((item) => {
          const name = item.name.toLowerCase();
          const description = (item.description ?? "").toLowerCase();
          const unit = (item.unit ?? "").toLowerCase();
          return (
            name.includes(quickServiceInventoryQuery) ||
            description.includes(quickServiceInventoryQuery) ||
            unit.includes(quickServiceInventoryQuery)
          );
        })
      : items;
    return [...visibleItems].sort((left, right) => {
      const statusRank =
        QUICK_SERVICE_STOCK_STATUS_RANK[quickServiceStockStatus(left)] -
        QUICK_SERVICE_STOCK_STATUS_RANK[quickServiceStockStatus(right)];
      if (statusRank !== 0) return statusRank;
      const nameRank = left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
      if (nameRank !== 0) return nameRank;
      return Number(left.id) - Number(right.id);
    });
  }, [quickServiceInvoiceInventory, quickServiceInventoryQuery]);

  const quickServiceInventoryById = useMemo(() => {
    const items = new Map<number, QuickServiceInventoryItem>();
    for (const item of quickServiceInventoryData ?? []) {
      items.set(Number(item.id), item);
    }
    return items;
  }, [quickServiceInventoryData]);

  // Drop legacy draft lines that point at Non-Consumable inventory (not invoice-selectable).
  useEffect(() => {
    if (!quickServiceInventoryData) return;
    setQuickServiceInventoryLines((current) => {
      const next = current.filter((line) => {
        const item = quickServiceInventoryById.get(Number(line.inventoryItemId));
        if (!item) return true; // keep until loaded / unknown; validation blocks submit
        return item.type === "consumable" || item.type === "bulk";
      });
      return next.length === current.length ? current : next;
    });
  }, [quickServiceInventoryData, quickServiceInventoryById]);

  const quickServiceSelectedInventoryIds = useMemo(
    () => new Set(quickServiceInventoryLines.map((line) => Number(line.inventoryItemId))),
    [quickServiceInventoryLines]
  );

  const quickServiceInventoryTotal = useMemo(() => {
    return quickServiceInventoryLines.reduce((sum, line) => {
      const item = quickServiceInventoryById.get(Number(line.inventoryItemId));
      if (!item || quickServiceLineQuantityIssue(item, line.quantity)) return sum;
      return sum + quickServiceLineTotal(line.quantity, line.unitPrice);
    }, 0);
  }, [quickServiceInventoryById, quickServiceInventoryLines]);

  const quickServiceManualTotal = useMemo(
    () => quickServiceManualLines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0),
    [quickServiceManualLines]
  );

  const quickServiceOverallTotal = quickServiceInventoryTotal + quickServiceManualTotal + quickServiceLabourAmount;

  const {
    data: addStockSuppliers,
    isLoading: addStockSuppliersLoading,
    isError: addStockSuppliersError,
    error: addStockSuppliersErrorObject,
  } = useQuery<QuickServiceSupplier[], Error>({
    queryKey: ["suppliers"],
    queryFn: () => apiFetch<QuickServiceSupplier[]>("/suppliers"),
    enabled: addStockItem != null,
  });

  const addStockParsedUnitCost = useMemo(() => {
    const raw = addStockUnitCost.trim();
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }, [addStockUnitCost]);

  const addStockCostDiffers =
    addStockItem != null &&
    addStockParsedUnitCost != null &&
    addStockItem.unit_cost != null &&
    Math.abs(Number(addStockItem.unit_cost) - addStockParsedUnitCost) > 0.0001;

  const openQuickServiceAddStock = (item: QuickServiceInventoryItem) => {
    setAddStockItem(item);
    setAddStockQuantity("");
    setAddStockUnitCost("");
    setAddStockSupplierId("");
    setAddStockNotes("");
    setAddStockUpdateInventoryCost(true);
  };

  const addStockMutation = useMutation<
    QuickServicePurchaseResult,
    Error,
    {
      supplierId: number;
      body: {
        inventory_item_id: number;
        item_name: string;
        quantity: number;
        unit_cost: number | null;
        payment_status: "unpaid";
        notes: string | null;
        update_inventory_price: boolean;
      };
    }
  >({
    mutationFn: ({ supplierId, body }) =>
      apiFetch<QuickServicePurchaseResult>(`/suppliers/${supplierId}/purchase`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: (purchase) => {
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["supplierPurchases"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({
        title: "Stock added",
        description: `${purchase.item_name} received (${purchase.quantity}). Click Add when you want to use it.`,
      });
      setAddStockItem(null);
    },
    onError: (error) => {
      toast({
        title: "Unable to add stock",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleAddStockOpenChange = (open: boolean) => {
    if (!open && addStockMutation.isPending) return;
    if (!open) setAddStockItem(null);
  };

  const handleAddStockSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!addStockItem || addStockMutation.isPending) return;

    const quantity = Number(addStockQuantity);
    if (!addStockQuantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Quantity received must be greater than 0.",
        variant: "destructive",
      });
      return;
    }

    const costRaw = addStockUnitCost.trim();
    let unitCost: number | null = null;
    if (costRaw) {
      unitCost = Number(costRaw);
      if (!Number.isFinite(unitCost) || unitCost < 0) {
        toast({
          title: "Invalid unit cost",
          description: "Unit cost must be 0 or more.",
          variant: "destructive",
        });
        return;
      }
    }

    const supplierId = Number(addStockSupplierId);
    if (!Number.isInteger(supplierId) || supplierId <= 0) {
      toast({
        title: "Supplier required",
        description: "Select an existing supplier for this stock intake.",
        variant: "destructive",
      });
      return;
    }

    const updateInventoryPrice =
      unitCost == null ? false : addStockCostDiffers ? addStockUpdateInventoryCost : true;

    addStockMutation.mutate({
      supplierId,
      body: {
        inventory_item_id: addStockItem.id,
        item_name: addStockItem.name,
        quantity,
        unit_cost: unitCost,
        payment_status: "unpaid",
        notes: addStockNotes.trim() || null,
        update_inventory_price: updateInventoryPrice,
      },
    });
  };

  const addQuickServiceInventoryItem = (item: QuickServiceInventoryItem) => {
    if (quickServiceStockStatus(item) === "out-of-stock") return;
    const sellingPrice =
      item.selling_price != null && Number.isFinite(Number(item.selling_price))
        ? String(Number(item.selling_price))
        : "";
    setQuickServiceInventoryLines((current) => {
      if (current.some((line) => Number(line.inventoryItemId) === Number(item.id))) return current;
      return [...current, { inventoryItemId: item.id, quantity: "1", unitPrice: sellingPrice }];
    });
    setQuickServiceInventoryResultsOpen(false);
  };

  const updateQuickServiceInventoryLine = (
    inventoryItemId: number,
    patch: Partial<Pick<QuickServiceInventoryLine, "quantity" | "unitPrice">>
  ) => {
    setQuickServiceInventoryLines((current) =>
      current.map((line) =>
        Number(line.inventoryItemId) === Number(inventoryItemId) ? { ...line, ...patch } : line
      )
    );
  };

  const removeQuickServiceInventoryItem = (inventoryItemId: number) => {
    setQuickServiceInventoryLines((current) =>
      current.filter((line) => Number(line.inventoryItemId) !== Number(inventoryItemId))
    );
  };

  const openQuickServiceManualPart = () => {
    setQuickServiceManualName("");
    setQuickServiceManualQuantity("1");
    setQuickServiceManualPrice("");
    setQuickServiceManualOpen(true);
  };

  const handleQuickServiceManualSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = quickServiceManualName.trim();
    const quantity = Number(quickServiceManualQuantity);
    const unitPrice = Number(quickServiceManualPrice);
    if (!name) {
      toast({
        title: "Part name required",
        description: "Enter a name for this one-time part.",
        variant: "destructive",
      });
      return;
    }
    if (!quickServiceManualQuantity.trim() || !Number.isFinite(quantity) || quantity <= 0) {
      toast({
        title: "Invalid quantity",
        description: "Quantity must be greater than 0.",
        variant: "destructive",
      });
      return;
    }
    if (!quickServiceManualPrice.trim() || !Number.isFinite(unitPrice) || unitPrice < 0) {
      toast({
        title: "Invalid invoice price",
        description: "Invoice unit price must be 0 or more.",
        variant: "destructive",
      });
      return;
    }
    quickServiceManualKeyRef.current += 1;
    setQuickServiceManualLines((current) => [
      ...current,
      {
        key: `manual-${quickServiceManualKeyRef.current}`,
        name,
        quantity,
        unitPrice: Number(unitPrice.toFixed(2)),
      },
    ]);
    setQuickServiceManualOpen(false);
    setQuickServiceManualName("");
    setQuickServiceManualQuantity("1");
    setQuickServiceManualPrice("");
  };

  const quickServiceActiveVehicles = useMemo(() => {
    const customerIds = new Set(customers.map((customer) => Number(customer.id)));
    return (quickServiceVehiclesData ?? []).filter(
      (vehicle) => (vehicle.archived ?? 0) === 0 && customerIds.has(Number(vehicle.customer_id))
    );
  }, [customers, quickServiceVehiclesData]);

  const quickServiceSearchQuery = quickServiceSearch.trim().toLowerCase();
  const quickServiceSearchKind = classifyQuickServiceSearchText(quickServiceSearch);
  const quickServiceSearchMatches = useMemo(() => {
    if (!quickServiceSearchQuery || quickServiceSearchKind === "empty") return [];
    const compactQuery = compactSearchValue(quickServiceSearchQuery);
    const matches = quickServiceActiveVehicles.flatMap((vehicle) => {
      const customer = customers.find((entry) => Number(entry.id) === Number(vehicle.customer_id));
      if (!customer) return [];

      const plateCompact = compactSearchValue(vehicle.license_plate);
      const exactPlate = compactQuery.length > 0 && plateCompact === compactQuery;
      let matched = false;

      if (quickServiceSearchKind === "registration") {
        // Registration mode: plate only — never match customer names from plate letters.
        matched = compactQuery.length > 0 && plateCompact.includes(compactQuery);
      } else if (quickServiceSearchKind === "phone") {
        matched = compactQuery.length > 0 && compactSearchValue(customer.phone).includes(compactQuery);
      } else if (quickServiceSearchKind === "name") {
        matched = customer.name.toLowerCase().includes(quickServiceSearchQuery);
      }

      if (!matched) return [];
      return [{ customer, vehicle, exactPlate }];
    });
    return matches.sort((left, right) => {
      if (left.exactPlate !== right.exactPlate) return left.exactPlate ? -1 : 1;
      return 0;
    });
  }, [customers, quickServiceActiveVehicles, quickServiceSearchKind, quickServiceSearchQuery]);

  const quickServiceExactRegistrationMatch = useMemo(
    () =>
      quickServiceSearchKind === "registration" &&
      quickServiceSearchMatches.some((entry) => entry.exactPlate),
    [quickServiceSearchKind, quickServiceSearchMatches]
  );

  /** Explicit customer pin (no vehicle yet). Search-result candidates alone do not count. */
  const quickServicePinnedCustomer = useMemo(() => {
    if (quickServiceCustomerId == null || quickServiceVehicleId != null) return null;
    return customers.find((entry) => Number(entry.id) === Number(quickServiceCustomerId)) ?? null;
  }, [customers, quickServiceCustomerId, quickServiceVehicleId]);

  /** Name/phone mode: customers the user can explicitly select (with or without vehicles). */
  const quickServiceCustomerCandidates = useMemo(() => {
    if (!quickServiceSearchQuery) return [];
    if (quickServiceSearchKind !== "name" && quickServiceSearchKind !== "phone") return [];
    const compactQuery = compactSearchValue(quickServiceSearchQuery);
    return customers.filter((customer) => {
      if (quickServiceSearchKind === "phone") {
        return compactQuery.length > 0 && compactSearchValue(customer.phone).includes(compactQuery);
      }
      return customer.name.toLowerCase().includes(quickServiceSearchQuery);
    });
  }, [customers, quickServiceSearchKind, quickServiceSearchQuery]);

  const quickServiceCustomersForNewVehicle = useMemo(() => {
    if (!quickServiceSearchQuery) return [];
    if (quickServiceExactRegistrationMatch) return [];
    if (quickServicePinnedCustomer == null) return [];

    if (quickServiceSearchKind === "registration") {
      return [quickServicePinnedCustomer];
    }

    if (quickServiceSearchKind === "name" || quickServiceSearchKind === "phone") {
      const compactQuery = compactSearchValue(quickServiceSearchQuery);
      const nameMatches = quickServicePinnedCustomer.name
        .toLowerCase()
        .includes(quickServiceSearchQuery);
      const phoneMatches =
        compactQuery.length > 0 &&
        compactSearchValue(quickServicePinnedCustomer.phone).includes(compactQuery);
      if (nameMatches || phoneMatches) return [quickServicePinnedCustomer];
    }

    return [];
  }, [
    quickServiceExactRegistrationMatch,
    quickServicePinnedCustomer,
    quickServiceSearchKind,
    quickServiceSearchQuery,
  ]);

  const quickServiceSelection = useMemo(() => {
    if (quickServiceCustomerId == null || quickServiceVehicleId == null) return null;
    const customer = customers.find((entry) => Number(entry.id) === Number(quickServiceCustomerId)) ?? null;
    const vehicle =
      quickServiceActiveVehicles.find((entry) => Number(entry.id) === Number(quickServiceVehicleId)) ?? null;
    if (!customer || !vehicle || Number(vehicle.customer_id) !== Number(customer.id)) return null;
    return { customer, vehicle };
  }, [customers, quickServiceActiveVehicles, quickServiceCustomerId, quickServiceVehicleId]);

  const resetQuickServiceNewCustomerForm = () => {
    setQuickServiceCreateOpen(false);
    setQuickServiceNewName("");
    setQuickServiceNewPhone("");
    setQuickServiceNewEmail("");
    setQuickServiceNewAddress("");
    setQuickServiceNewPlate("");
    setQuickServiceNewMake("");
    setQuickServiceNewModel("");
    setQuickServiceNewYear("");
  };

  const resetQuickServiceNewVehicleForm = () => {
    setQuickServiceAddVehicleOpen(false);
    setQuickServiceAddVehicleCustomerId(null);
    setQuickServiceAddVehicleCustomerSearch("");
    setQuickServiceExistingPlate("");
    setQuickServiceExistingMake("");
    setQuickServiceExistingModel("");
    setQuickServiceExistingYear("");
  };

  const openQuickServiceCreateCustomer = () => {
    const searchText = quickServiceSearch.trim();
    const kind = classifyQuickServiceSearchText(searchText);
    setQuickServiceResultsOpen(false);
    setQuickServiceAddVehicleOpen(false);
    setQuickServiceNewName(kind === "name" ? searchText : "");
    setQuickServiceNewPhone(kind === "phone" ? searchText : "");
    setQuickServiceNewEmail("");
    setQuickServiceNewAddress("");
    setQuickServiceNewPlate(kind === "registration" ? searchText : "");
    setQuickServiceNewMake("");
    setQuickServiceNewModel("");
    setQuickServiceNewYear("");
    setQuickServiceCreateOpen(true);
  };

  const openQuickServiceAddVehicle = (customer: Customer) => {
    const searchText = quickServiceSearch.trim();
    const kind = classifyQuickServiceSearchText(searchText);
    setQuickServiceCreateOpen(false);
    setQuickServiceResultsOpen(false);
    setQuickServiceAddVehicleCustomerSearch("");
    setQuickServiceAddVehicleCustomerId(customer.id);
    setQuickServiceExistingPlate(kind === "registration" ? searchText : "");
    setQuickServiceExistingMake("");
    setQuickServiceExistingModel("");
    setQuickServiceExistingYear("");
    setQuickServiceAddVehicleOpen(true);
  };

  const openQuickServiceAddVehicleToExisting = () => {
    const searchText = quickServiceSearch.trim();
    const kind = classifyQuickServiceSearchText(searchText);
    setQuickServiceCreateOpen(false);
    setQuickServiceResultsOpen(false);
    setQuickServiceAddVehicleCustomerId(null);
    setQuickServiceAddVehicleCustomerSearch("");
    setQuickServiceExistingPlate(kind === "registration" ? searchText : "");
    setQuickServiceExistingMake("");
    setQuickServiceExistingModel("");
    setQuickServiceExistingYear("");
    setQuickServiceAddVehicleOpen(true);
  };

  const resetQuickServiceForm = () => {
    clearQuickServiceDraft();
    setQuickServiceSearch("");
    setQuickServiceResultsOpen(false);
    setQuickServiceCustomerId(null);
    setQuickServiceVehicleId(null);
    setQuickServiceType("");
    setQuickServiceCustomService("");
    setQuickServiceSelectedServices([]);
    setQuickServicePickerKey(0);
    setQuickServiceNotes("");
    setQuickServicePaymentStatus("unpaid");
    setQuickServicePaymentMethod("Cash");
    setQuickServiceCustomPaymentMethod("");
    setQuickServiceInventorySearch("");
    setQuickServiceInventoryResultsOpen(false);
    setQuickServiceInventoryLines([]);
    setQuickServiceManualLines([]);
    setQuickServiceManualOpen(false);
    setQuickServiceManualName("");
    setQuickServiceManualQuantity("1");
    setQuickServiceManualPrice("");
    resetQuickServiceNewCustomerForm();
    resetQuickServiceNewVehicleForm();
  };

  const createQuickServiceCustomerMutation = useMutation<CreatedCustomerResponse, Error, CreateCustomerPayload>({
    mutationFn: (payload) =>
      apiFetch<CreatedCustomerResponse>("/customers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      const customer: Customer = {
        id: created.id,
        name: created.name,
        email: created.email ?? null,
        phone: created.phone ?? null,
        address: created.address ?? null,
      };
      const vehicle = created.vehicle;

      if (!vehicle?.id) {
        queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
        toast({
          title: "Vehicle was not created",
          description: "The customer was saved, but no vehicle was returned to select.",
          variant: "destructive",
        });
        return;
      }

      queryClient.setQueryData<Customer[]>(CUSTOMERS_QUERY_KEY, (current) => {
        const list = current ?? [];
        if (list.some((entry) => Number(entry.id) === Number(customer.id))) return list;
        return [...list, customer];
      });
      queryClient.setQueryData<Vehicle[]>(QUICK_SERVICE_VEHICLES_QUERY_KEY, (current) => {
        const list = current ?? [];
        const nextVehicle: Vehicle = { ...vehicle, archived: 0 };
        if (list.some((entry) => Number(entry.id) === Number(vehicle.id))) return list;
        return [nextVehicle, ...list];
      });
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: QUICK_SERVICE_VEHICLES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["customerVehicles"] });

      setQuickServiceCustomerId(customer.id);
      setQuickServiceVehicleId(vehicle.id);
      setQuickServiceSearch("");
      setQuickServiceResultsOpen(false);
      resetQuickServiceNewCustomerForm();
      toast({
        title: "Customer and vehicle added",
        description: `${customer.name} · ${vehicle.license_plate || "vehicle"} is selected for this quick service.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Unable to add customer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleQuickServiceCreateCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createQuickServiceCustomerMutation.isPending) return;

    const name = quickServiceNewName.trim();
    const licensePlate = quickServiceNewPlate.trim();
    const make = quickServiceNewMake.trim();
    const model = quickServiceNewModel.trim();

    if (!name || !licensePlate || !make || !model) {
      toast({
        title: "Missing required details",
        description: "Customer name, registration number, make, and model are required.",
        variant: "destructive",
      });
      return;
    }

    createQuickServiceCustomerMutation.mutate({
      name,
      phone: quickServiceNewPhone.trim() || undefined,
      email: quickServiceNewEmail.trim() || undefined,
      address: quickServiceNewAddress.trim() || undefined,
      license_plate: licensePlate,
      make,
      model,
      year: quickServiceNewYear.trim() || undefined,
    });
  };

  const quickServiceAddVehicleCustomer =
    customers.find((customer) => Number(customer.id) === Number(quickServiceAddVehicleCustomerId)) ?? null;

  const quickServiceAddVehicleCustomerMatches = useMemo(() => {
    const query = quickServiceAddVehicleCustomerSearch.trim().toLowerCase();
    if (!query) return [];
    const compactQuery = compactSearchValue(query);
    return customers
      .filter((customer) => {
        const nameMatches = customer.name.toLowerCase().includes(query);
        const phoneMatches =
          compactQuery.length > 0 && compactSearchValue(customer.phone).includes(compactQuery);
        return nameMatches || phoneMatches;
      })
      .slice(0, 25);
  }, [customers, quickServiceAddVehicleCustomerSearch]);

  const createQuickServiceVehicleMutation = useMutation<
    Vehicle,
    Error,
    { customer_id: number; license_plate: string; make: string; model: string; year?: string }
  >({
    mutationFn: (payload) =>
      apiFetch<Vehicle>("/vehicles", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (created) => {
      const customer = customers.find((entry) => Number(entry.id) === Number(created.customer_id));
      const vehicle: Vehicle = { ...created, archived: 0 };
      queryClient.setQueryData<Vehicle[]>(QUICK_SERVICE_VEHICLES_QUERY_KEY, (current) => {
        const list = current ?? [];
        if (list.some((entry) => Number(entry.id) === Number(vehicle.id))) return list;
        return [vehicle, ...list];
      });
      queryClient.invalidateQueries({ queryKey: QUICK_SERVICE_VEHICLES_QUERY_KEY });
      queryClient.invalidateQueries({ queryKey: ["customerVehicles"] });

      if (!customer || Number(vehicle.customer_id) !== Number(customer.id)) {
        toast({
          title: "Vehicle was not selected",
          description: "The vehicle was saved, but it could not be matched to the customer.",
          variant: "destructive",
        });
        return;
      }

      setQuickServiceCustomerId(customer.id);
      setQuickServiceVehicleId(vehicle.id);
      setQuickServiceSearch("");
      setQuickServiceResultsOpen(false);
      resetQuickServiceNewVehicleForm();
      toast({
        title: "Vehicle added",
        description: `${vehicle.license_plate || "New vehicle"} is selected for ${customer.name}.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Unable to add vehicle",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleQuickServiceCreateVehicle = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (createQuickServiceVehicleMutation.isPending || !quickServiceAddVehicleCustomer) return;

    const licensePlate = quickServiceExistingPlate.trim();
    const make = quickServiceExistingMake.trim();
    const model = quickServiceExistingModel.trim();

    if (!licensePlate || !make || !model) {
      toast({
        title: "Missing required details",
        description: "Registration number, make, and model are required.",
        variant: "destructive",
      });
      return;
    }

    createQuickServiceVehicleMutation.mutate({
      customer_id: quickServiceAddVehicleCustomer.id,
      license_plate: licensePlate,
      make,
      model,
      year: quickServiceExistingYear.trim() || undefined,
    });
  };

  const quickServiceEffectiveServiceName =
    quickServiceType === QUICK_SERVICE_OTHER
      ? normalizeQuickServiceName(quickServiceCustomService)
      : quickServiceType;

  const quickServiceEffectivePaymentMethod = (() => {
    if (quickServicePaymentMethod === PAYMENT_METHOD_OTHER_VALUE) {
      const customMethod = quickServiceCustomPaymentMethod.trim();
      return customMethod || null;
    }
    if (!quickServicePaymentMethod || quickServicePaymentMethod === PAYMENT_METHOD_NONE_VALUE) {
      return null;
    }
    return quickServicePaymentMethod;
  })();

  const quickServicePaymentMethodRequired =
    quickServicePaymentStatus === "paid" || quickServicePaymentStatus === "partial";
  const quickServiceCustomPaymentMissing =
    quickServicePaymentMethod === PAYMENT_METHOD_OTHER_VALUE && quickServiceEffectivePaymentMethod == null;
  const quickServiceHasInvalidInventoryLine = quickServiceInventoryLines.some((line) => {
    const item = quickServiceInventoryById.get(Number(line.inventoryItemId));
    if (!item) return true;
    if (item.type === "non-consumable") return true;
    if (quickServiceLineQuantityIssue(item, line.quantity)) return true;
    return quickServiceLinePriceIssue(line.unitPrice) != null;
  });
  const quickServiceCompleteDisabled =
    !quickServiceSelection ||
    quickServiceSelectedServices.length === 0 ||
    quickServiceHasInvalidServiceCharge ||
    quickServiceHasInvalidInventoryLine ||
    quickServiceCustomPaymentMissing ||
    (quickServicePaymentMethodRequired && quickServiceEffectivePaymentMethod == null);

  const createQuickServiceMutation = useMutation<
    { invoice_id: number; invoice_number: string },
    Error,
    {
      customer_id: number;
      vehicle_id: number;
      services: Array<{ name: string; charge: number }>;
      description?: string;
      notes?: string;
      items: Array<
        | { inventory_item_id: number; quantity: number; unit_price: number }
        | { item_name: string; quantity: number; unit_price: number }
      >;
      payment_status: (typeof QUICK_SERVICE_PAYMENT_STATUSES)[number];
      payment_method: string | null;
    }
  >({
    mutationFn: (payload) =>
      apiFetch("/jobs/quick-service", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["recentJobs"] });
      queryClient.invalidateQueries({ queryKey: ["invoices"] });
      queryClient.invalidateQueries({ queryKey: ["inventory"] });
      queryClient.invalidateQueries({ queryKey: ["dashboardStats"] });
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast({
        title: "Invoice created",
        description: result.invoice_number
          ? `${result.invoice_number} is ready.`
          : "The quick service invoice was created.",
      });
      resetQuickServiceForm();
      navigate("/invoices", { state: { invoiceId: result.invoice_id } });
    },
    onError: (error) => {
      toast({
        title: "Unable to create invoice",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleQuickServiceTypeChange = (value: string) => {
    setQuickServiceType(value);
    if (value !== QUICK_SERVICE_OTHER) {
      setQuickServiceCustomService("");
    }
  };

  const appendQuickServiceSelection = (serviceName: string) => {
    quickServiceSelectedKeyRef.current += 1;
    setQuickServiceSelectedServices((current) => [
      ...current,
      {
        key: `svc-${quickServiceSelectedKeyRef.current}`,
        name: serviceName,
        charge: "",
      },
    ]);
    setQuickServiceType("");
    setQuickServiceCustomService("");
    setQuickServicePickerKey((current) => current + 1);
  };

  const handleAddQuickService = async () => {
    const name = normalizeQuickServiceName(quickServiceEffectiveServiceName);
    if (!name) {
      toast({
        title: "Service required",
        description:
          quickServiceType === QUICK_SERVICE_OTHER
            ? "Enter a custom service name."
            : "Select a service to add.",
        variant: "destructive",
      });
      return;
    }
    if (
      quickServiceSelectedServices.some(
        (service) => service.name.toLowerCase() === name.toLowerCase()
      )
    ) {
      toast({
        title: "Service already added",
        description: `${name} is already in the selected services list.`,
        variant: "destructive",
      });
      return;
    }

    const isOtherFlow = quickServiceType === QUICK_SERVICE_OTHER;
    const isBuiltInDefault = QUICK_SERVICE_DEFAULT_OPTIONS.some(
      (option) => option.toLowerCase() === name.toLowerCase()
    );
    const isOtherLabel = name.toLowerCase() === QUICK_SERVICE_OTHER.toLowerCase();

    let serviceName = name;
    if (isOtherFlow && !isBuiltInDefault && !isOtherLabel) {
      if (createQuickServiceCustomServiceMutation.isPending) return;
      try {
        const saved = await createQuickServiceCustomServiceMutation.mutateAsync({ name });
        serviceName = normalizeQuickServiceName(saved.name) || name;
      } catch (error) {
        toast({
          title: "Unable to save custom service",
          description: error instanceof Error ? error.message : "Please try again.",
          variant: "destructive",
        });
        return;
      }
    }

    if (
      quickServiceSelectedServices.some(
        (service) => service.name.toLowerCase() === serviceName.toLowerCase()
      )
    ) {
      toast({
        title: "Service already added",
        description: `${serviceName} is already in the selected services list.`,
        variant: "destructive",
      });
      return;
    }

    appendQuickServiceSelection(serviceName);
  };

  const updateQuickServiceCharge = (key: string, charge: string) => {
    setQuickServiceSelectedServices((current) =>
      current.map((service) => (service.key === key ? { ...service, charge } : service))
    );
  };

  const removeQuickService = (key: string) => {
    setQuickServiceSelectedServices((current) => current.filter((service) => service.key !== key));
  };

  const selectQuickServiceVehicle = (customer: Customer, vehicle: Vehicle) => {
    if ((vehicle.archived ?? 0) !== 0) return;
    if (Number(vehicle.customer_id) !== Number(customer.id)) return;
    setQuickServiceCustomerId(customer.id);
    setQuickServiceVehicleId(vehicle.id);
    setQuickServiceResultsOpen(false);
  };

  const selectQuickServiceCustomer = (customer: Customer) => {
    setQuickServiceCustomerId(customer.id);
    setQuickServiceVehicleId(null);
    setQuickServiceResultsOpen(true);
  };

  const clearQuickServiceSelection = () => {
    setQuickServiceCustomerId(null);
    setQuickServiceVehicleId(null);
    setQuickServiceResultsOpen(true);
    quickServiceSearchRef.current?.focus();
  };

  const handleQuickServiceSubmit = () => {
    if (createQuickServiceMutation.isPending || quickServiceCompleteDisabled || !quickServiceSelection) return;

    const detail = quickServiceNotes.trim();
    createQuickServiceMutation.mutate({
      customer_id: quickServiceSelection.customer.id,
      vehicle_id: quickServiceSelection.vehicle.id,
      services: quickServiceSelectedServices.map((service) => ({
        name: service.name,
        charge: Number(service.charge),
      })),
      ...(detail ? { description: detail, notes: detail } : {}),
      items: [
        ...quickServiceInventoryLines.map((line) => ({
          inventory_item_id: Number(line.inventoryItemId),
          quantity: Number(line.quantity),
          unit_price: line.unitPrice.trim() === "" ? 0 : Number(line.unitPrice),
        })),
        ...quickServiceManualLines.map((line) => ({
          item_name: line.name,
          quantity: line.quantity,
          unit_price: line.unitPrice,
        })),
      ],
      payment_status: quickServicePaymentStatus,
      payment_method: quickServiceEffectivePaymentMethod,
    });
  };

  return (
    <div className="space-y-6 [&_button]:rounded-md [&_input:focus-visible]:ring-primary/40 [&_textarea:focus-visible]:ring-primary/40">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">Quick Service</h1>
        <p className="text-muted-foreground">Record a fast counter service for a customer and vehicle.</p>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1.55fr)_minmax(19rem,0.85fr)]">
        <div className="space-y-4">
          <section className={quickServiceSectionCardClass}>
            <Label htmlFor="qs-search" className={quickServiceSectionLabelClass}>
              Customer / Vehicle
            </Label>

            {!quickServiceSelection ? (
              <>
                {quickServicePinnedCustomer ? (
                  <div className="mb-2 flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 text-sm">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-foreground">{quickServicePinnedCustomer.name}</p>
                      {quickServicePinnedCustomer.phone?.trim() ? (
                        <p className="text-muted-foreground">{quickServicePinnedCustomer.phone}</p>
                      ) : null}
                      <p className="text-muted-foreground">
                        Customer selected. Search for a vehicle or add a new one.
                      </p>
                    </div>
                    <Button type="button" variant="outline" size="sm" onClick={clearQuickServiceSelection}>
                      Change
                    </Button>
                  </div>
                ) : null}
                <Input
                  id="qs-search"
                  ref={quickServiceSearchRef}
                  value={quickServiceSearch}
                  onChange={(event) => {
                    setQuickServiceSearch(event.target.value);
                    setQuickServiceResultsOpen(true);
                  }}
                  onFocus={() => setQuickServiceResultsOpen(true)}
                  placeholder="Search by name, phone, or vehicle number"
                  autoComplete="off"
                />
                {quickServiceResultsOpen && quickServiceSearchQuery && (
                  <div className="max-h-48 overflow-y-auto rounded-md border bg-popover">
                    {customersLoading || quickServiceVehiclesLoading ? (
                      <p className="px-3 py-2 text-sm text-muted-foreground">Searching customers and vehicles...</p>
                    ) : customersError || quickServiceVehiclesError ? (
                      <p className="px-3 py-2 text-sm text-destructive">Unable to load customers or vehicles.</p>
                    ) : quickServiceSearchMatches.length === 0 &&
                      quickServiceCustomersForNewVehicle.length === 0 &&
                      quickServiceCustomerCandidates.length === 0 ? (
                      <div className="space-y-2 px-3 py-2">
                        {quickServiceSearchKind === "registration" ? (
                          <>
                            <p className="text-sm text-muted-foreground">No matching vehicle found for:</p>
                            <p className="text-sm font-medium text-foreground">{quickServiceSearch.trim()}</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-start"
                              onClick={openQuickServiceAddVehicleToExisting}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add to Existing Customer
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-start"
                              onClick={openQuickServiceCreateCustomer}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add New Customer & Vehicle
                            </Button>
                          </>
                        ) : (
                          <>
                            <p className="text-sm text-muted-foreground">No matching customers or vehicles.</p>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full justify-start"
                              onClick={openQuickServiceCreateCustomer}
                            >
                              <Plus className="mr-2 h-4 w-4" />
                              Add New Customer & Vehicle
                            </Button>
                          </>
                        )}
                      </div>
                    ) : (
                      <div>
                        {quickServiceSearchMatches.length > 0 && (
                          <ul>
                            {quickServiceSearchMatches.map(({ customer, vehicle }) => {
                              const vehicleName = formatQuickServiceVehicleName(vehicle);
                              const plate = vehicle.license_plate?.trim();
                              const isSelected =
                                Number(quickServiceCustomerId) === Number(customer.id) &&
                                Number(quickServiceVehicleId) === Number(vehicle.id);
                              return (
                                <li key={`${customer.id}-${vehicle.id}`}>
                                  <button
                                    type="button"
                                    className={`flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent ${
                                      isSelected ? "bg-accent" : ""
                                    }`}
                                    onClick={() => selectQuickServiceVehicle(customer, vehicle)}
                                  >
                                    <span className="font-medium text-foreground">
                                      {customer.name}
                                      {customer.phone?.trim() ? (
                                        <span className="ml-2 font-normal text-muted-foreground">{customer.phone}</span>
                                      ) : null}
                                    </span>
                                    <span className="text-muted-foreground">
                                      {[plate, vehicleName].filter(Boolean).join(" · ") || "Vehicle details not available"}
                                    </span>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {quickServiceCustomerCandidates.length > 0 && (
                          <div
                            className={`space-y-1 px-2 py-2 ${
                              quickServiceSearchMatches.length > 0 ? "border-t" : ""
                            }`}
                          >
                            {quickServiceCustomerCandidates.map((customer) => {
                              const isPinned =
                                quickServicePinnedCustomer != null &&
                                Number(quickServicePinnedCustomer.id) === Number(customer.id);
                              return (
                                <Button
                                  key={`select-customer-${customer.id}`}
                                  type="button"
                                  variant={isPinned ? "secondary" : "outline"}
                                  size="sm"
                                  className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                                  onClick={() => selectQuickServiceCustomer(customer)}
                                  disabled={isPinned}
                                >
                                  <span>
                                    {isPinned ? "Selected: " : "Select customer: "}
                                    {customer.name}
                                    {customer.phone?.trim() ? (
                                      <span className="ml-1 font-normal text-muted-foreground">
                                        {customer.phone}
                                      </span>
                                    ) : null}
                                  </span>
                                </Button>
                              );
                            })}
                          </div>
                        )}
                        {quickServiceCustomersForNewVehicle.length > 0 && (
                          <div
                            className={`space-y-1 px-2 py-2 ${
                              quickServiceSearchMatches.length > 0 ||
                              quickServiceCustomerCandidates.length > 0
                                ? "border-t"
                                : ""
                            }`}
                          >
                            {quickServiceSearchKind === "registration" &&
                            quickServiceSearchMatches.length === 0 ? (
                              <p className="px-1 pb-1 text-sm text-muted-foreground">
                                Vehicle not found for this customer.
                              </p>
                            ) : quickServiceSearchMatches.length === 0 ? (
                              <p className="px-1 pb-1 text-sm text-muted-foreground">
                                Customer found, but that vehicle is not on file.
                              </p>
                            ) : null}
                            {quickServiceCustomersForNewVehicle.map((customer) => (
                              <Button
                                key={customer.id}
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-auto w-full justify-start whitespace-normal py-2 text-left"
                                onClick={() => openQuickServiceAddVehicle(customer)}
                              >
                                <Plus className="mr-2 h-4 w-4 shrink-0" />
                                <span>
                                  Add New Vehicle to {customer.name}
                                  {customer.phone?.trim() ? (
                                    <span className="ml-1 font-normal text-muted-foreground">{customer.phone}</span>
                                  ) : null}
                                </span>
                              </Button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {!quickServicePinnedCustomer ? (
                  <p className="text-sm text-muted-foreground">No customer or vehicle selected.</p>
                ) : null}
              </>
            ) : (
              <div className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-3 text-sm">
                <div className="min-w-0 space-y-1">
                  <p className="font-medium text-foreground">{quickServiceSelection.customer.name}</p>
                  {quickServiceSelection.customer.phone?.trim() ? (
                    <p className="text-muted-foreground">{quickServiceSelection.customer.phone}</p>
                  ) : null}
                  <p className="pt-0.5 text-muted-foreground">
                    <span className="font-medium text-foreground/80">Vehicle:</span>{" "}
                    {[
                      quickServiceSelection.vehicle.license_plate?.trim(),
                      formatQuickServiceVehicleName(quickServiceSelection.vehicle),
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Vehicle"}
                  </p>
                </div>
                <Button type="button" variant="outline" size="sm" onClick={clearQuickServiceSelection}>
                  Change
                </Button>
              </div>
            )}
          </section>

          <section className={quickServiceSectionCardClass}>
            <Label className={quickServiceSectionLabelClass}>Services</Label>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <div className="min-w-0 flex-1 space-y-2">
                <Select
                  key={quickServicePickerKey}
                  value={quickServiceType || undefined}
                  onValueChange={handleQuickServiceTypeChange}
                >
                  <SelectTrigger id="qs-service">
                    <SelectValue placeholder="Select a service" />
                  </SelectTrigger>
                  <SelectContent>
                    {quickServiceDropdownOptions.map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {quickServiceType === QUICK_SERVICE_OTHER && (
                  <Input
                    id="qs-custom-service"
                    value={quickServiceCustomService}
                    onChange={(event) => setQuickServiceCustomService(event.target.value)}
                    placeholder="Custom service name"
                  />
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                className="shrink-0"
                onClick={() => void handleAddQuickService()}
                disabled={createQuickServiceCustomServiceMutation.isPending}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                {createQuickServiceCustomServiceMutation.isPending ? "Saving..." : "Add Service"}
              </Button>
            </div>

            {quickServiceSelectedServices.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
                Add at least one service before completing Quick Service.
              </div>
            ) : (
              <div className="space-y-2">
                {quickServiceSelectedServices.map((service) => {
                  const chargeRaw = service.charge.trim();
                  const chargeInvalid =
                    !chargeRaw || !Number.isFinite(Number(chargeRaw)) || Number(chargeRaw) < 0;
                  return (
                    <div key={service.key} className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="min-w-0 truncate text-sm font-medium text-foreground">{service.name}</p>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 shrink-0 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeQuickService(service.key)}
                        >
                          Remove
                        </Button>
                      </div>
                      <Label
                        htmlFor={`qs-service-charge-${service.key}`}
                        className="mt-1.5 block text-xs text-muted-foreground"
                      >
                        Labour / Service Charge
                      </Label>
                      <Input
                        id={`qs-service-charge-${service.key}`}
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        className="mt-1 h-8 w-full max-w-[9rem]"
                        value={service.charge}
                        onChange={(event) => updateQuickServiceCharge(service.key, event.target.value)}
                        placeholder="0.00"
                        aria-label={`${service.name} labour charge`}
                      />
                      {chargeInvalid ? (
                        <p className="mt-1 text-xs text-destructive">Charge must be a number of 0 or more.</p>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section className={quickServiceSectionCardClass}>
            <Label htmlFor="qs-notes" className={quickServiceSectionLabelClass}>
              Description / Notes
            </Label>
            <Textarea
              id="qs-notes"
              value={quickServiceNotes}
              onChange={(event) => setQuickServiceNotes(event.target.value)}
              placeholder="What was done..."
              rows={2}
              className="min-h-[72px]"
            />
          </section>

          <section className={quickServiceSectionCardClass}>
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="qs-inventory-search" className={quickServiceSectionLabelClass}>
                Inventory / One-time Parts
              </Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 font-normal"
                onClick={openQuickServiceManualPart}
              >
                <Plus className="mr-1 h-3.5 w-3.5" />
                Add One-time Part
              </Button>
            </div>
            <div
              onBlur={(event) => {
                const nextTarget = event.relatedTarget;
                if (!(nextTarget instanceof Node) || !event.currentTarget.contains(nextTarget)) {
                  setQuickServiceInventoryResultsOpen(false);
                }
              }}
            >
              <Input
                id="qs-inventory-search"
                value={quickServiceInventorySearch}
                onChange={(event) => {
                  setQuickServiceInventorySearch(event.target.value);
                  setQuickServiceInventoryResultsOpen(true);
                }}
                onFocus={() => setQuickServiceInventoryResultsOpen(true)}
                onClick={() => setQuickServiceInventoryResultsOpen(true)}
                placeholder="Search by name, description, or unit"
                autoComplete="off"
              />
              {quickServiceInventoryError && (
                <p className="mt-1 text-sm text-destructive">
                  Unable to load inventory. The rest of this quick service can still be filled in.
                </p>
              )}
              {quickServiceInventoryResultsOpen && !quickServiceInventoryError && (
                <div
                  className="mt-1 max-h-64 overflow-y-auto rounded-md border bg-popover shadow-sm"
                  onMouseDown={(event) => event.preventDefault()}
                >
                  {quickServiceInventoryLoading ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">Loading inventory...</p>
                  ) : quickServiceInventoryMatches.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-muted-foreground">
                      {quickServiceInventoryQuery ? "No matching inventory items." : "No inventory items."}
                    </p>
                  ) : (
                    <ul>
                      {quickServiceInventoryMatches.map((item) => {
                        const alreadyAdded = quickServiceSelectedInventoryIds.has(Number(item.id));
                        const stockStatus = quickServiceStockStatus(item);
                        const outOfStock = stockStatus === "out-of-stock";
                        const genuineLabel = quickServiceGenuineLabel(item.genuine_or_non_genuine);
                        return (
                          <li
                            key={item.id}
                            className="flex items-start justify-between gap-3 border-b px-3 py-2 transition-colors last:border-b-0 hover:bg-muted/40"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground">{item.name}</p>
                              <div className="mt-1 flex flex-wrap items-center gap-1">
                                <Badge
                                  variant="secondary"
                                  className="h-5 rounded-full px-1.5 py-0 text-[10px] font-medium leading-none"
                                >
                                  {quickServiceInventoryTypeLabel(item.type)}
                                </Badge>
                                {genuineLabel ? (
                                  <Badge
                                    variant="outline"
                                    className="h-5 rounded-full px-1.5 py-0 text-[10px] font-medium leading-none"
                                  >
                                    {genuineLabel}
                                  </Badge>
                                ) : null}
                                <Badge className={quickServiceStockStatusBadgeClass[stockStatus]}>
                                  {QUICK_SERVICE_STOCK_STATUS_LABEL[stockStatus]}
                                </Badge>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Available: {formatQuickServiceStock(Number(item.quantity), item.unit)}
                              </p>
                              <p className="mt-0.5 text-xs text-muted-foreground">
                                {item.selling_price != null && Number.isFinite(Number(item.selling_price))
                                  ? `Selling: ${formatQuickServiceCurrency(Number(item.selling_price))}`
                                  : "Selling price not set"}
                              </p>
                              {outOfStock && !alreadyAdded ? (
                                <p className="mt-0.5 text-xs text-destructive">
                                  Out of stock. This item cannot be added.
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 items-center gap-1.5 pt-0.5">
                              {alreadyAdded ? (
                                <span className="text-xs text-muted-foreground">Already added</span>
                              ) : outOfStock ? (
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  className="font-normal text-muted-foreground hover:bg-muted hover:text-foreground"
                                  onClick={() => openQuickServiceAddStock(item)}
                                >
                                  Add Stock
                                </Button>
                              ) : (
                                <Button type="button" size="sm" onClick={() => addQuickServiceInventoryItem(item)}>
                                  Add
                                </Button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              )}
            </div>

            {quickServiceInventoryLines.length === 0 && quickServiceManualLines.length === 0 ? (
              <div className="rounded-md border border-dashed bg-muted/20 px-3 py-2.5 text-sm text-muted-foreground">
                No inventory items added.
              </div>
            ) : (
              <div className="space-y-2">
                {quickServiceInventoryLines.map((line) => {
                  const item = quickServiceInventoryById.get(Number(line.inventoryItemId));
                  const quantityIssue = item
                    ? quickServiceLineQuantityIssue(item, line.quantity) ??
                      quickServiceLinePriceIssue(line.unitPrice)
                    : "This item is no longer in inventory.";
                  const lineTotal = quickServiceLineTotal(line.quantity, line.unitPrice);
                  return (
                    <div
                      key={line.inventoryItemId}
                      className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {item?.name ?? `Item #${line.inventoryItemId}`}
                          </p>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5">
                            {item ? (
                              <Badge className={quickServiceStockStatusBadgeClass[quickServiceStockStatus(item)]}>
                                {QUICK_SERVICE_STOCK_STATUS_LABEL[quickServiceStockStatus(item)]}
                              </Badge>
                            ) : null}
                            <p className="text-xs text-muted-foreground">
                              {item
                                ? `Available: ${formatQuickServiceStock(Number(item.quantity), item.unit)}`
                                : "Unavailable"}
                            </p>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() => removeQuickServiceInventoryItem(line.inventoryItemId)}
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <Label htmlFor={`qs-item-qty-${line.inventoryItemId}`} className="text-xs text-muted-foreground">
                            Quantity
                          </Label>
                          <Input
                            id={`qs-item-qty-${line.inventoryItemId}`}
                            type="number"
                            min="0"
                            step="0.001"
                            className="h-8"
                            value={line.quantity}
                            onChange={(event) =>
                              updateQuickServiceInventoryLine(line.inventoryItemId, {
                                quantity: event.target.value,
                              })
                            }
                          />
                        </div>
                        <div className="space-y-1">
                          <Label
                            htmlFor={`qs-item-price-${line.inventoryItemId}`}
                            className="text-xs text-muted-foreground"
                          >
                            Invoice Price
                          </Label>
                          <Input
                            id={`qs-item-price-${line.inventoryItemId}`}
                            type="number"
                            min="0"
                            step="0.01"
                            className="h-8"
                            value={line.unitPrice}
                            onChange={(event) =>
                              updateQuickServiceInventoryLine(line.inventoryItemId, {
                                unitPrice: event.target.value,
                              })
                            }
                            placeholder="0.00"
                          />
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Line Total</p>
                          <p className="flex h-8 items-center text-sm font-medium">
                            {formatQuickServiceCurrency(lineTotal)}
                          </p>
                        </div>
                      </div>
                      {quantityIssue && <p className="mt-1 text-xs text-destructive">{quantityIssue}</p>}
                    </div>
                  );
                })}
                {quickServiceManualLines.map((line) => {
                  const lineTotal = line.quantity * line.unitPrice;
                  return (
                    <div key={line.key} className="rounded-md border border-border/70 bg-muted/15 px-3 py-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{line.name}</p>
                          <div className="mt-1">
                            <Badge
                              variant="outline"
                              className="h-5 rounded-full px-1.5 py-0 text-[10px] font-medium leading-none"
                            >
                              One-time Part
                            </Badge>
                          </div>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
                          onClick={() =>
                            setQuickServiceManualLines((current) =>
                              current.filter((entry) => entry.key !== line.key)
                            )
                          }
                        >
                          Remove
                        </Button>
                      </div>
                      <div className="mt-2 grid grid-cols-3 gap-2">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Quantity</p>
                          <p className="flex h-8 items-center text-sm">{line.quantity}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Invoice Price</p>
                          <p className="flex h-8 items-center text-sm">
                            {formatQuickServiceCurrency(line.unitPrice)}
                          </p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Line Total</p>
                          <p className="flex h-8 items-center text-sm font-medium">
                            {formatQuickServiceCurrency(lineTotal)}
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </div>

        <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
          <section className={quickServiceSectionCardClass}>
            <p className={quickServiceSectionLabelClass}>Payment</p>
            <div className="space-y-1.5">
              <Label htmlFor="qs-payment-status" className="text-xs text-muted-foreground">
                Payment Status
              </Label>
              <Select
                value={quickServicePaymentStatus}
                onValueChange={(value) =>
                  setQuickServicePaymentStatus(value as (typeof QUICK_SERVICE_PAYMENT_STATUSES)[number])
                }
              >
                <SelectTrigger id="qs-payment-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {QUICK_SERVICE_PAYMENT_STATUSES.map((status) => (
                    <SelectItem key={status} value={status}>
                      {status.charAt(0).toUpperCase() + status.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <PaymentMethodSelector
              label="Payment Method"
              value={
                quickServicePaymentStatus !== "unpaid" &&
                (quickServicePaymentMethod === PAYMENT_METHOD_NONE_VALUE || quickServicePaymentMethod === "")
                  ? ""
                  : quickServicePaymentMethod
              }
              onValueChange={setQuickServicePaymentMethod}
              customValue={quickServiceCustomPaymentMethod}
              onCustomValueChange={setQuickServiceCustomPaymentMethod}
              includeNotSpecified={quickServicePaymentStatus === "unpaid"}
              helperText={
                quickServicePaymentMethodRequired
                  ? "Required for partial and paid."
                  : "Optional for unpaid. Not specified leaves it blank."
              }
              placeholder="Custom payment method"
              idPrefix="qs-payment-method"
              className="space-y-2"
            />
            {quickServiceCustomPaymentMissing && (
              <p className="text-xs text-destructive">Enter a custom payment method.</p>
            )}
            {!quickServiceCustomPaymentMissing &&
              quickServicePaymentMethodRequired &&
              quickServiceEffectivePaymentMethod == null && (
                <p className="text-xs text-destructive">Select a payment method.</p>
              )}
          </section>

          <section className={`${quickServiceSectionCardClass} border-primary/20 bg-primary/[0.04]`}>
            <p className={quickServiceSectionLabelClass}>Total Summary</p>
            <div className="space-y-1.5 text-sm">
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Inventory items</span>
                <span>{formatQuickServiceCurrency(quickServiceInventoryTotal)}</span>
              </div>
              {quickServiceManualLines.length > 0 ? (
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>One-time extras</span>
                  <span>{formatQuickServiceCurrency(quickServiceManualTotal)}</span>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-muted-foreground">
                <span>Service / labour</span>
                <span>{formatQuickServiceCurrency(quickServiceLabourAmount)}</span>
              </div>
              <div className="flex items-center justify-between border-t border-primary/15 pt-2 font-semibold text-foreground">
                <span>Total</span>
                <span className="text-primary">{formatQuickServiceCurrency(quickServiceOverallTotal)}</span>
              </div>
            </div>
          </section>

          <div className="flex flex-col gap-2 sm:flex-row xl:flex-col">
            <Button
              type="button"
              className={`${quickServicePrimaryButtonClass} w-full sm:flex-1 xl:w-full`}
              disabled={quickServiceCompleteDisabled || createQuickServiceMutation.isPending}
              onClick={handleQuickServiceSubmit}
            >
              {createQuickServiceMutation.isPending ? "Creating Invoice..." : "Complete & Create Invoice"}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="w-full sm:w-auto xl:w-full"
              onClick={resetQuickServiceForm}
              disabled={createQuickServiceMutation.isPending}
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>

      <Dialog
        open={quickServiceCreateOpen}
        onOpenChange={(open) => {
          if (!open && !createQuickServiceCustomerMutation.isPending) {
            resetQuickServiceNewCustomerForm();
          } else if (open) {
            setQuickServiceCreateOpen(true);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New Customer & Vehicle</DialogTitle>
            <DialogDescription>
              This customer and vehicle will be selected for the quick service.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleQuickServiceCreateCustomer} className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="qs-new-name">Customer Name *</Label>
                <Input
                  id="qs-new-name"
                  value={quickServiceNewName}
                  onChange={(event) => setQuickServiceNewName(event.target.value)}
                  placeholder="Full name"
                  required
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-new-phone">Phone</Label>
                <Input
                  id="qs-new-phone"
                  type="tel"
                  value={quickServiceNewPhone}
                  onChange={(event) => setQuickServiceNewPhone(event.target.value)}
                  placeholder="07X XXX XXXX"
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-new-email">Email</Label>
                <Input
                  id="qs-new-email"
                  type="email"
                  value={quickServiceNewEmail}
                  onChange={(event) => setQuickServiceNewEmail(event.target.value)}
                  placeholder="email@example.com"
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="qs-new-address">Address</Label>
                <Input
                  id="qs-new-address"
                  value={quickServiceNewAddress}
                  onChange={(event) => setQuickServiceNewAddress(event.target.value)}
                  placeholder="Address"
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-new-plate">Registration Number *</Label>
                <Input
                  id="qs-new-plate"
                  value={quickServiceNewPlate}
                  onChange={(event) => setQuickServiceNewPlate(event.target.value)}
                  placeholder="e.g. ABC-1234"
                  required
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-new-year">Year</Label>
                <Input
                  id="qs-new-year"
                  value={quickServiceNewYear}
                  onChange={(event) => setQuickServiceNewYear(event.target.value)}
                  placeholder="e.g. 2020"
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-new-make">Make *</Label>
                <Input
                  id="qs-new-make"
                  value={quickServiceNewMake}
                  onChange={(event) => setQuickServiceNewMake(event.target.value)}
                  placeholder="e.g. Honda"
                  required
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-new-model">Model *</Label>
                <Input
                  id="qs-new-model"
                  value={quickServiceNewModel}
                  onChange={(event) => setQuickServiceNewModel(event.target.value)}
                  placeholder="e.g. Civic"
                  required
                  disabled={createQuickServiceCustomerMutation.isPending}
                />
              </div>
            </div>
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={resetQuickServiceNewCustomerForm}
                disabled={createQuickServiceCustomerMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                className={quickServicePrimaryButtonClass}
                disabled={createQuickServiceCustomerMutation.isPending}
              >
                {createQuickServiceCustomerMutation.isPending ? "Saving..." : "Save Customer & Vehicle"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={quickServiceAddVehicleOpen}
        onOpenChange={(open) => {
          if (!open && !createQuickServiceVehicleMutation.isPending) {
            resetQuickServiceNewVehicleForm();
          } else if (open) {
            setQuickServiceAddVehicleOpen(true);
          }
        }}
      >
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {quickServiceAddVehicleCustomer
                ? `New Vehicle for ${quickServiceAddVehicleCustomer.name}`
                : "Add Vehicle to Existing Customer"}
            </DialogTitle>
            <DialogDescription>
              {quickServiceAddVehicleCustomer
                ? "This vehicle will be added to the existing customer and selected for the quick service."
                : "Search by name or phone, then enter the new vehicle details. No new customer will be created."}
            </DialogDescription>
          </DialogHeader>

          {!quickServiceAddVehicleCustomer ? (
            <div className="space-y-3">
              {quickServiceExistingPlate.trim() ? (
                <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
                  Registration:{" "}
                  <span className="font-medium text-foreground">{quickServiceExistingPlate.trim()}</span>
                </p>
              ) : null}
              <div className="space-y-1.5">
                <Label htmlFor="qs-add-vehicle-customer-search">Find customer</Label>
                <Input
                  id="qs-add-vehicle-customer-search"
                  value={quickServiceAddVehicleCustomerSearch}
                  onChange={(event) => setQuickServiceAddVehicleCustomerSearch(event.target.value)}
                  placeholder="Search by name or phone"
                  autoComplete="off"
                  disabled={createQuickServiceVehicleMutation.isPending}
                />
              </div>
              <div className="max-h-48 overflow-y-auto rounded-md border bg-popover">
                {!quickServiceAddVehicleCustomerSearch.trim() ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    Type a name or phone number to find a customer.
                  </p>
                ) : quickServiceAddVehicleCustomerMatches.length === 0 ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">No matching customers.</p>
                ) : (
                  <ul>
                    {quickServiceAddVehicleCustomerMatches.map((customer) => (
                      <li key={customer.id}>
                        <button
                          type="button"
                          className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-accent"
                          onClick={() => setQuickServiceAddVehicleCustomerId(customer.id)}
                        >
                          <span className="font-medium text-foreground">{customer.name}</span>
                          {customer.phone?.trim() ? (
                            <span className="text-muted-foreground">{customer.phone}</span>
                          ) : null}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <DialogFooter className="gap-2 sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetQuickServiceNewVehicleForm}
                  disabled={createQuickServiceVehicleMutation.isPending}
                >
                  Cancel
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={handleQuickServiceCreateVehicle} className="space-y-3">
              <div className="flex items-start justify-between gap-3 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-foreground">{quickServiceAddVehicleCustomer.name}</p>
                  {quickServiceAddVehicleCustomer.phone?.trim() ? (
                    <p className="text-muted-foreground">{quickServiceAddVehicleCustomer.phone}</p>
                  ) : null}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setQuickServiceAddVehicleCustomerId(null);
                    setQuickServiceAddVehicleCustomerSearch("");
                  }}
                  disabled={createQuickServiceVehicleMutation.isPending}
                >
                  Change
                </Button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="qs-existing-plate">Registration Number *</Label>
                  <Input
                    id="qs-existing-plate"
                    value={quickServiceExistingPlate}
                    onChange={(event) => setQuickServiceExistingPlate(event.target.value)}
                    placeholder="e.g. ABC-1234"
                    required
                    disabled={createQuickServiceVehicleMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qs-existing-make">Make *</Label>
                  <Input
                    id="qs-existing-make"
                    value={quickServiceExistingMake}
                    onChange={(event) => setQuickServiceExistingMake(event.target.value)}
                    placeholder="e.g. Honda"
                    required
                    disabled={createQuickServiceVehicleMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qs-existing-model">Model *</Label>
                  <Input
                    id="qs-existing-model"
                    value={quickServiceExistingModel}
                    onChange={(event) => setQuickServiceExistingModel(event.target.value)}
                    placeholder="e.g. Civic"
                    required
                    disabled={createQuickServiceVehicleMutation.isPending}
                  />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="qs-existing-year">Year</Label>
                  <Input
                    id="qs-existing-year"
                    value={quickServiceExistingYear}
                    onChange={(event) => setQuickServiceExistingYear(event.target.value)}
                    placeholder="e.g. 2020"
                    disabled={createQuickServiceVehicleMutation.isPending}
                  />
                </div>
              </div>
              <DialogFooter className="gap-2 sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={resetQuickServiceNewVehicleForm}
                  disabled={createQuickServiceVehicleMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className={quickServicePrimaryButtonClass}
                  disabled={createQuickServiceVehicleMutation.isPending}
                >
                  {createQuickServiceVehicleMutation.isPending ? "Saving..." : "Save Vehicle"}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addStockItem != null} onOpenChange={handleAddStockOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Stock</DialogTitle>
            <DialogDescription>
              Record received stock for this item. It is saved as a supplier purchase and does not add the item to
              this service.
            </DialogDescription>
          </DialogHeader>
          {addStockItem ? (
            <form onSubmit={handleAddStockSubmit} className="space-y-3">
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
                <p className="font-medium text-foreground">{addStockItem.name}</p>
                <p className="text-muted-foreground">
                  Current stock: {formatQuickServiceStock(Number(addStockItem.quantity), addStockItem.unit)}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-add-stock-supplier">Supplier</Label>
                <Select
                  value={addStockSupplierId || undefined}
                  onValueChange={setAddStockSupplierId}
                  disabled={addStockMutation.isPending || addStockSuppliersLoading}
                >
                  <SelectTrigger id="qs-add-stock-supplier">
                    <SelectValue
                      placeholder={addStockSuppliersLoading ? "Loading suppliers..." : "Select a supplier"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(addStockSuppliers ?? []).map((supplier) => (
                      <SelectItem key={supplier.id} value={String(supplier.id)}>
                        {supplier.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {addStockSuppliersError ? (
                  <p className="text-xs text-destructive">
                    {addStockSuppliersErrorObject?.message ?? "Unable to load suppliers."}
                  </p>
                ) : null}
                {!addStockSuppliersLoading && !addStockSuppliersError && (addStockSuppliers ?? []).length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No suppliers yet. Add one from the Suppliers page before recording stock.
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-add-stock-quantity">Quantity received</Label>
                <Input
                  id="qs-add-stock-quantity"
                  type="number"
                  min="0"
                  step="0.001"
                  value={addStockQuantity}
                  onChange={(event) => setAddStockQuantity(event.target.value)}
                  placeholder="0"
                  required
                  disabled={addStockMutation.isPending}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-add-stock-cost">Unit cost (LKR)</Label>
                <Input
                  id="qs-add-stock-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={addStockUnitCost}
                  onChange={(event) => setAddStockUnitCost(event.target.value)}
                  placeholder="Optional"
                  disabled={addStockMutation.isPending}
                />
                <p className="text-xs text-muted-foreground">
                  Purchase cost only. It is not used as the invoice selling price.
                </p>
                {addStockCostDiffers ? (
                  <label className="flex items-start gap-2 text-xs text-foreground">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={addStockUpdateInventoryCost}
                      onChange={(event) => setAddStockUpdateInventoryCost(event.target.checked)}
                      disabled={addStockMutation.isPending}
                    />
                    <span>
                      Update the inventory unit cost from{" "}
                      {formatQuickServiceCurrency(Number(addStockItem.unit_cost))} to this purchase cost.
                    </span>
                  </label>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-add-stock-notes">Notes</Label>
                <Textarea
                  id="qs-add-stock-notes"
                  value={addStockNotes}
                  onChange={(event) => setAddStockNotes(event.target.value)}
                  placeholder="Optional purchase note"
                  rows={2}
                  disabled={addStockMutation.isPending}
                />
              </div>
              <DialogFooter className="gap-2 sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleAddStockOpenChange(false)}
                  disabled={addStockMutation.isPending}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  className={quickServicePrimaryButtonClass}
                  disabled={
                    addStockMutation.isPending ||
                    addStockSuppliersLoading ||
                    addStockSuppliersError ||
                    (addStockSuppliers ?? []).length === 0
                  }
                >
                  {addStockMutation.isPending ? "Saving..." : "Save Stock"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={quickServiceManualOpen} onOpenChange={setQuickServiceManualOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add One-time Part</DialogTitle>
            <DialogDescription>
              Add a part bought for this service. It is included on the invoice and is not taken from inventory.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleQuickServiceManualSubmit} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="qs-manual-name">Part / Item Name</Label>
              <Input
                id="qs-manual-name"
                value={quickServiceManualName}
                onChange={(event) => setQuickServiceManualName(event.target.value)}
                placeholder="Part name"
                autoComplete="off"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="qs-manual-qty">Quantity</Label>
                <Input
                  id="qs-manual-qty"
                  type="number"
                  min="0"
                  step="0.001"
                  value={quickServiceManualQuantity}
                  onChange={(event) => setQuickServiceManualQuantity(event.target.value)}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="qs-manual-price">Invoice Unit Price</Label>
                <Input
                  id="qs-manual-price"
                  type="number"
                  min="0"
                  step="0.01"
                  value={quickServiceManualPrice}
                  onChange={(event) => setQuickServiceManualPrice(event.target.value)}
                  placeholder="0.00"
                  required
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              This selling price is for the invoice only. It does not change inventory.
            </p>
            <DialogFooter className="gap-2 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => setQuickServiceManualOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className={quickServicePrimaryButtonClass}>
                Add Part
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default QuickService;
