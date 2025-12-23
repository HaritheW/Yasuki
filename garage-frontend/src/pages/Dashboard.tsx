import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Plus,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Wrench,
  CheckCircle2,
  Clock,
  Users,
  Edit,
  Trash2,
  XCircle,
  BarChart3,
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";

const revenueData = [
  { month: "Jan", revenue: 45000, expenses: 32000 },
  { month: "Feb", revenue: 52000, expenses: 35000 },
  { month: "Mar", revenue: 48000, expenses: 33000 },
  { month: "Apr", revenue: 61000, expenses: 38000 },
  { month: "May", revenue: 55000, expenses: 36000 },
  { month: "Jun", revenue: 67000, expenses: 40000 },
];

const jobData = [
  { day: "Mon", completed: 12, pending: 5 },
  { day: "Tue", completed: 15, pending: 3 },
  { day: "Wed", completed: 8, pending: 7 },
  { day: "Thu", completed: 14, pending: 4 },
  { day: "Fri", completed: 18, pending: 6 },
  { day: "Sat", completed: 10, pending: 2 },
  { day: "Sun", completed: 5, pending: 1 },
];

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
};

const CUSTOMERS_QUERY_KEY = ["customers"];

type DashboardStats = {
  month: number;
  year: number;
  totalRevenue: number;
  totalExpenses: number;
  netProfit: number;
  activeJobs: number;
  jobStatuses: Array<{
    status: JobStatus;
    count: number;
  }>;
  weeklyData: Array<{
    week: number;
    weekStart: string;
    weekEnd: string;
    revenue: number;
    expenses: number;
  }>;
};

type JobStatus = "Pending" | "In Progress" | "Completed" | "Cancelled";

type RecentJob = {
  id: number;
  customer_id: number;
  customer_name: string | null;
  vehicle_id: number | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_year: string | null;
  vehicle_license_plate: string | null;
  job_status: JobStatus;
  category: string | null;
  description: string | null;
  created_at: string;
  technicians: Array<{
    id: number;
    name: string;
    status: string;
  }>;
};

const generateMonthOptions = (count = 24) => {
  const months: { label: string; month: number; year: number }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i += 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const month = date.getMonth() + 1;
    const year = date.getFullYear();
    const label = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(date);
    months.push({ label, month, year });
  }
  return months;
};

const Dashboard = () => {
  const now = useMemo(() => new Date(), []);
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1);
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [viewCustomersOpen, setViewCustomersOpen] = useState(false);
  const [customerDetailOpen, setCustomerDetailOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [deleteCustomerOpen, setDeleteCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const monthOptions = useMemo(() => generateMonthOptions(24), []);

  const {
    data: dashboardStats,
    isLoading: dashboardStatsLoading,
    isError: dashboardStatsError,
  } = useQuery<DashboardStats, Error>({
    queryKey: ["dashboardStats", selectedMonth, selectedYear],
    queryFn: () =>
      apiFetch<DashboardStats>(`/reports/dashboard?month=${selectedMonth}&year=${selectedYear}`),
  });

  const {
    data: recentJobsData,
    isLoading: recentJobsLoading,
    isError: recentJobsError,
  } = useQuery<RecentJob[], Error>({
    queryKey: ["recentJobs"],
    queryFn: () => apiFetch<RecentJob[]>("/jobs"),
  });

  const recentJobs = useMemo(() => {
    if (!recentJobsData) return [];
    return recentJobsData.slice(0, 4);
  }, [recentJobsData]);

  const {
    data: customersData,
    isLoading: customersLoading,
    isError: customersError,
    error: customersErrorObject,
  } = useQuery<Customer[], Error>({
    queryKey: CUSTOMERS_QUERY_KEY,
    queryFn: () => apiFetch<Customer[]>("/customers"),
  });

  const customers = customersData ?? [];

  const vehiclesQueryKey = ["customerVehicles", selectedCustomer?.id ?? "none"];
  const customerVehiclesEnabled =
    Boolean(selectedCustomer?.id) && (customerDetailOpen || editCustomerOpen);

  const {
    data: customerVehicles,
    isLoading: customerVehiclesLoading,
    isError: customerVehiclesError,
    error: customerVehiclesErrorObject,
  } = useQuery<Vehicle[], Error>({
    queryKey: vehiclesQueryKey,
    queryFn: () => apiFetch<Vehicle[]>(`/vehicles?customer_id=${selectedCustomer?.id ?? ""}`),
    enabled: customerVehiclesEnabled,
  });

  const activeCustomerVehicles = useMemo(
    () => (customerVehicles ?? []).filter((vehicle) => (vehicle.archived ?? 0) === 0),
    [customerVehicles]
  );

  const [vehicleEdits, setVehicleEdits] = useState<
    Record<number, { make: string; model: string; year: string; license_plate: string }>
  >({});
  const [vehicleSavingId, setVehicleSavingId] = useState<number | null>(null);
  const [vehicleDeletingId, setVehicleDeletingId] = useState<number | null>(null);

  useEffect(() => {
    if (!activeCustomerVehicles || activeCustomerVehicles.length === 0) {
      setVehicleEdits({});
      return;
    }

    setVehicleEdits(() => {
      const next: Record<number, { make: string; model: string; year: string; license_plate: string }> = {};
      activeCustomerVehicles.forEach((vehicle) => {
        next[vehicle.id] = {
          make: vehicle.make ?? "",
          model: vehicle.model ?? "",
          year: vehicle.year ?? "",
          license_plate: vehicle.license_plate ?? "",
        };
      });
      return next;
    });
  }, [activeCustomerVehicles]);

  const updateVehicleMutation = useMutation<
    Vehicle,
    Error,
    { id: number; payload: { make: string; model: string; year: string | null; license_plate: string | null } }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<Vehicle>(`/vehicles/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onMutate: ({ id }) => {
      setVehicleSavingId(id);
    },
    onSuccess: (vehicle) => {
      toast({
        title: "Vehicle updated",
        description: `${vehicle.make ?? "Vehicle"} ${vehicle.model ?? ""} updated successfully.`,
      });
      queryClient.invalidateQueries({ queryKey: vehiclesQueryKey });
    },
    onError: (error) => {
      toast({
        title: "Unable to update vehicle",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setVehicleSavingId(null);
    },
  });

  const deleteVehicleMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/vehicles/${id}`, {
        method: "DELETE",
      }),
    onMutate: (id) => {
      setVehicleDeletingId(id);
    },
    onSuccess: (_, id) => {
      toast({
        title: "Vehicle unassigned",
        description: "Vehicle removed from customer successfully.",
      });
      setVehicleEdits((prev) => {
        const { [id]: _removed, ...rest } = prev;
        return rest;
      });
      queryClient.invalidateQueries({ queryKey: vehiclesQueryKey });
    },
    onError: (error) => {
      toast({
        title: "Unable to unassign vehicle",
        description: error.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      setVehicleDeletingId(null);
    },
  });

  const handleVehicleFieldChange = (
    vehicleId: number,
    field: "make" | "model" | "year" | "license_plate",
    value: string
  ) => {
    setVehicleEdits((prev) => ({
      ...prev,
      [vehicleId]: {
        make: prev[vehicleId]?.make ?? "",
        model: prev[vehicleId]?.model ?? "",
        year: prev[vehicleId]?.year ?? "",
        license_plate: prev[vehicleId]?.license_plate ?? "",
        [field]: value,
      },
    }));
  };

  const handleSaveVehicle = (vehicleId: number) => {
    const edits = vehicleEdits[vehicleId];
    if (!edits) return;

    const trimmedMake = edits.make.trim();
    const trimmedModel = edits.model.trim();

    if (!trimmedMake || !trimmedModel) {
      toast({
        title: "Vehicle details required",
        description: "Please provide both make and model before saving.",
        variant: "destructive",
      });
      return;
    }

    updateVehicleMutation.mutate({
      id: vehicleId,
      payload: {
        make: trimmedMake,
        model: trimmedModel,
        year: edits.year.trim() ? edits.year.trim() : null,
        license_plate: edits.license_plate.trim() ? edits.license_plate.trim() : null,
      },
    });
  };

  const handleUnassignVehicle = (vehicleId: number) => {
    deleteVehicleMutation.mutate(vehicleId);
  };

  const createCustomerMutation = useMutation<
    Customer,
    Error,
    CreateCustomerPayload
  >({
    mutationFn: (payload) =>
      apiFetch<Customer>("/customers", {
        method: "POST",
        body: JSON.stringify(payload),
      }),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
      toast({
        title: "Customer Added",
        description: `${customer.name} has been added successfully.`,
      });
      setAddCustomerOpen(false);
    },
    onError: (error) => {
      toast({
        title: "Unable to add customer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateCustomerMutation = useMutation<
    Customer,
    Error,
    { id: number; payload: CreateCustomerPayload }
  >({
    mutationFn: ({ id, payload }) =>
      apiFetch<Customer>(`/customers/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      }),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
      toast({
        title: "Customer updated",
        description: `${customer.name} has been updated successfully.`,
      });
      setSelectedCustomer(customer);
      setEditCustomerOpen(false);
      setCustomerDetailOpen(true);
    },
    onError: (error) => {
      toast({
        title: "Unable to update customer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteCustomerMutation = useMutation<void, Error, number>({
    mutationFn: (id) =>
      apiFetch(`/customers/${id}`, {
        method: "DELETE",
      }),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: CUSTOMERS_QUERY_KEY });
      toast({
        title: "Customer deleted",
        description: `Customer #${id} has been deleted.`,
      });
      setDeleteCustomerOpen(false);
      setCustomerDetailOpen(false);
      setSelectedCustomer(null);
    },
    onError: (error) => {
      toast({
        title: "Unable to delete customer",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const totalRevenue = dashboardStats?.totalRevenue ?? 0;
  const totalExpenses = dashboardStats?.totalExpenses ?? 0;
  const netProfit = dashboardStats?.netProfit ?? 0;
  const activeJobs = dashboardStats?.activeJobs ?? 0;
  const profitMargin = totalRevenue > 0 ? ((netProfit / totalRevenue) * 100).toFixed(1) : "0.0";
  const formatDashboardCurrency = (value: number) =>
    new Intl.NumberFormat(undefined, { style: "currency", currency: "LKR" }).format(value);

  const selectedMonthLabel = useMemo(() => {
    const option = monthOptions.find(
      (opt) => opt.month === selectedMonth && opt.year === selectedYear
    );
    return option?.label || `${selectedMonth}/${selectedYear}`;
  }, [monthOptions, selectedMonth, selectedYear]);

  const handleMonthChange = (value: string) => {
    const option = monthOptions.find((opt) => `${opt.month}-${opt.year}` === value);
    if (option) {
      setSelectedMonth(option.month);
      setSelectedYear(option.year);
    }
  };

  const getJobStatusIcon = (status: JobStatus) => {
    switch (status) {
      case "Completed":
        return <CheckCircle2 className="h-5 w-5 text-success" />;
      case "In Progress":
        return <Clock className="h-5 w-5 text-warning" />;
      case "Pending":
        return <Clock className="h-5 w-5 text-muted-foreground" />;
      case "Cancelled":
        return <XCircle className="h-5 w-5 text-destructive" />;
      default:
        return <Clock className="h-5 w-5 text-muted-foreground" />;
    }
  };

  const formatJobTitle = (job: RecentJob) => {
    const description = job.description || job.category || "Job";
    const vehicleParts = [
      job.vehicle_make,
      job.vehicle_model,
      job.vehicle_year,
    ].filter(Boolean);
    const vehicle = vehicleParts.length > 0 ? vehicleParts.join(" ") : null;
    return vehicle ? `${description} - ${vehicle}` : description;
  };

  const formatRelativeTime = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays === 1) return "Yesterday";
    if (diffDays < 7) return `${diffDays} days ago`;
    if (diffDays < 30) {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks} week${weeks > 1 ? "s" : ""} ago`;
    }
    if (diffDays < 365) {
      const months = Math.floor(diffDays / 30);
      return `${months} month${months > 1 ? "s" : ""} ago`;
    }
    const years = Math.floor(diffDays / 365);
    return `${years} year${years > 1 ? "s" : ""} ago`;
  };

  // Job status colors matching the Jobs page badge styles
  const JOB_STATUS_COLORS: Record<JobStatus, string> = {
    Pending: "hsl(220, 14%, 70%)",
    "In Progress": "hsl(var(--warning))",
    Completed: "hsl(var(--success))",
    Cancelled: "hsl(var(--destructive))",
  };

  // Transform job statuses for pie chart
  const jobStatusChartData = useMemo(() => {
    if (!dashboardStats?.jobStatuses) return [];
    
    const statusOrder: JobStatus[] = ["Pending", "In Progress", "Completed", "Cancelled"];
    return statusOrder.map((status) => {
      const statusData = dashboardStats.jobStatuses.find((s) => s.status === status);
      return {
        name: status,
        value: statusData?.count || 0,
        color: JOB_STATUS_COLORS[status],
      };
    }).filter((item) => item.value > 0); // Only show statuses with jobs
  }, [dashboardStats?.jobStatuses]);

  // Transform weekly data for Revenue vs Expenses chart
  const weeklyChartData = useMemo(() => {
    if (!dashboardStats?.weeklyData) return [];
    
    return dashboardStats.weeklyData.map((week) => ({
      week: `Week ${week.week}`,
      revenue: Number(week.revenue.toFixed(2)),
      expenses: Number(week.expenses.toFixed(2)),
    }));
  }, [dashboardStats?.weeklyData]);

  const handleAddCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    const getValue = (key: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value.trim() : "";
    };

    const payload: CreateCustomerPayload = {
      name: getValue("name"),
      email: getValue("email") || undefined,
      phone: getValue("phone") || undefined,
      address: getValue("address") || undefined,
    };

    if (!payload.name) {
      toast({
        title: "Customer name is required",
        description: "Please provide a name before creating the customer.",
        variant: "destructive",
      });
      return;
    }

    createCustomerMutation.mutate(payload, {
      onSuccess: () => {
        form.reset();
      },
    });
  };

  const handleUpdateCustomer = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedCustomer) return;

    const form = event.currentTarget;
    const formData = new FormData(form);

    const getValue = (key: string) => {
      const value = formData.get(key);
      return typeof value === "string" ? value.trim() : "";
    };

    const payload: CreateCustomerPayload = {
      name: getValue("name"),
      email: getValue("email") || undefined,
      phone: getValue("phone") || undefined,
      address: getValue("address") || undefined,
    };

    if (!payload.name) {
    toast({
        title: "Customer name is required",
        description: "Please provide a name before saving changes.",
        variant: "destructive",
    });
      return;
    }

    updateCustomerMutation.mutate(
      { id: selectedCustomer.id, payload },
      {
        onSuccess: () => {
          form.reset();
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Dashboard</h1>
          <p className="text-muted-foreground">Welcome back! Here's your garage overview</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="month-select" className="text-sm text-muted-foreground">
              Month:
            </Label>
            <Select
              value={`${selectedMonth}-${selectedYear}`}
              onValueChange={handleMonthChange}
            >
              <SelectTrigger id="month-select" className="w-[200px]">
                <SelectValue placeholder="Select month" />
              </SelectTrigger>
              <SelectContent>
                {monthOptions.map((option) => (
                  <SelectItem key={`${option.month}-${option.year}`} value={`${option.month}-${option.year}`}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-3">
          <Dialog open={addCustomerOpen} onOpenChange={setAddCustomerOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Add Customer
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Customer</DialogTitle>
                <DialogDescription>Fill in the details to add a new customer</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddCustomer} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="name">Full Name</Label>
                  <Input id="name" name="name" placeholder="John Doe" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email">Email</Label>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    placeholder="john@example.com"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    name="phone"
                    type="tel"
                    placeholder="+1234567890"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="address">Address</Label>
                  <Input id="address" name="address" placeholder="123 Main St, City, State" />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setAddCustomerOpen(false)}>
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    className="bg-primary"
                    disabled={createCustomerMutation.isPending}
                  >
                    {createCustomerMutation.isPending ? "Adding..." : "Add Customer"}
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          
          <Dialog open={viewCustomersOpen} onOpenChange={setViewCustomersOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Users className="mr-2 h-4 w-4" />
                View Customers
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Existing Customers</DialogTitle>
                <DialogDescription>View all registered customers</DialogDescription>
              </DialogHeader>
              <div className="rounded-md border">
                <table className="w-full">
                  <thead>
                    <tr className="border-b bg-muted/50">
                      <th className="p-3 text-left text-sm font-medium">Customer ID</th>
                      <th className="p-3 text-left text-sm font-medium">Name</th>
                      <th className="p-3 text-left text-sm font-medium">Email</th>
                      <th className="p-3 text-left text-sm font-medium">Phone</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customersLoading && (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-4 text-center text-sm text-muted-foreground"
                        >
                          Loading customers...
                        </td>
                      </tr>
                    )}
                    {customersError && !customersLoading && (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-4 text-center text-sm text-destructive"
                        >
                          {customersErrorObject?.message ?? "Failed to load customers."}
                        </td>
                      </tr>
                    )}
                    {!customersLoading && !customersError && customers.length === 0 && (
                      <tr>
                        <td
                          colSpan={4}
                          className="p-4 text-center text-sm text-muted-foreground"
                        >
                          No customers found.
                        </td>
                      </tr>
                    )}
                    {!customersLoading &&
                      !customersError &&
                      customers.map((customer) => (
                        <tr
                          key={customer.id}
                          className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                          onClick={() => {
                            setSelectedCustomer(customer);
                            setViewCustomersOpen(false);
                            setCustomerDetailOpen(true);
                          }}
                        >
                        <td className="p-3 font-medium">{customer.id}</td>
                        <td className="p-3">{customer.name}</td>
                          <td className="p-3 text-muted-foreground">
                            {customer.email || "—"}
                          </td>
                          <td className="p-3 text-muted-foreground">
                            {customer.phone || "—"}
                          </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={customerDetailOpen}
            onOpenChange={setCustomerDetailOpen}
          >
            <DialogContent className="max-w-2xl">
              <DialogHeader>
                <DialogTitle>Customer Details</DialogTitle>
                <DialogDescription>
                  Complete information for {selectedCustomer?.name ?? "customer"}
                </DialogDescription>
              </DialogHeader>
              {selectedCustomer && (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label className="text-muted-foreground">Customer ID</Label>
                      <p className="font-semibold">{selectedCustomer.id}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Name</Label>
                      <p className="font-semibold">{selectedCustomer.name}</p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Email</Label>
                      <p className="font-semibold">
                        {selectedCustomer.email || "Not provided"}
                      </p>
                    </div>
                    <div>
                      <Label className="text-muted-foreground">Phone</Label>
                      <p className="font-semibold">
                        {selectedCustomer.phone || "Not provided"}
                      </p>
                    </div>
                    <div className="col-span-2">
                      <Label className="text-muted-foreground">Address</Label>
                      <p className="font-semibold">
                        {selectedCustomer.address || "Not provided"}
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2 pt-4 border-t">
                    <Label className="text-muted-foreground">Assigned Vehicles</Label>
                    {customerVehiclesLoading && (
                      <p className="text-sm text-muted-foreground">Loading vehicles...</p>
                    )}
                    {customerVehiclesError && (
                      <p className="text-sm text-destructive">
                        {customerVehiclesErrorObject?.message ?? "Unable to load vehicles for this customer."}
                      </p>
                    )}
                    {!customerVehiclesLoading &&
                      !customerVehiclesError &&
                      activeCustomerVehicles.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No vehicles linked to this customer yet.
                        </p>
                      )}
                    {!customerVehiclesLoading &&
                      !customerVehiclesError &&
                      activeCustomerVehicles.length > 0 && (
                        <div className="space-y-2">
                          {activeCustomerVehicles.map((vehicle) => (
                            <div
                              key={vehicle.id}
                              className="rounded-md border border-muted px-3 py-2"
                            >
                              <p className="font-semibold">
                                {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
                                {vehicle.year ? ` ${vehicle.year}` : ""}
                              </p>
                              <p className="text-sm text-muted-foreground">
                                Plate: {vehicle.license_plate || "Not provided"}
                              </p>
                            </div>
                          ))}
                        </div>
                      )}
                  </div>

                  <div className="flex gap-3 pt-4 border-t">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => {
                        setCustomerDetailOpen(false);
                        setEditCustomerOpen(true);
                      }}
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      className="flex-1"
                      onClick={() => {
                        setCustomerDetailOpen(false);
                        setDeleteCustomerOpen(true);
                      }}
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete
                    </Button>
                  </div>
                </div>
              )}
            </DialogContent>
          </Dialog>

          <Dialog
            open={editCustomerOpen}
            onOpenChange={setEditCustomerOpen}
          >
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Edit Customer</DialogTitle>
                <DialogDescription>
                  Update customer details for {selectedCustomer?.name ?? "customer"}
                </DialogDescription>
              </DialogHeader>
              {selectedCustomer && (
                <form onSubmit={handleUpdateCustomer} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="editName">Full Name</Label>
                    <Input
                      id="editName"
                      name="name"
                      defaultValue={selectedCustomer.name}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editEmail">Email</Label>
                    <Input
                      id="editEmail"
                      name="email"
                      type="email"
                      defaultValue={selectedCustomer.email ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editPhone">Phone Number</Label>
                    <Input
                      id="editPhone"
                      name="phone"
                      type="tel"
                      defaultValue={selectedCustomer.phone ?? ""}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editAddress">Address</Label>
                    <Input
                      id="editAddress"
                      name="address"
                      defaultValue={selectedCustomer.address ?? ""}
                    />
                  </div>
                  <div className="space-y-2 pt-4 border-t">
                    <Label>Assigned Vehicles</Label>
                    {customerVehiclesLoading && customerVehiclesEnabled && (
                      <p className="text-sm text-muted-foreground">Loading vehicles...</p>
                    )}
                    {customerVehiclesError && customerVehiclesEnabled && (
                      <p className="text-sm text-destructive">
                        {customerVehiclesErrorObject?.message ?? "Unable to load vehicles for this customer."}
                      </p>
                    )}
                    {!customerVehiclesLoading &&
                      !customerVehiclesError &&
                      activeCustomerVehicles.length === 0 && (
                        <p className="text-sm text-muted-foreground">
                          No vehicles are currently assigned to this customer.
                        </p>
                      )}
                    {!customerVehiclesLoading &&
                      !customerVehiclesError &&
                      activeCustomerVehicles.length > 0 && (
                        <div className="space-y-3">
                          {activeCustomerVehicles.map((vehicle) => {
                            const original = {
                              make: vehicle.make ?? "",
                              model: vehicle.model ?? "",
                              year: vehicle.year ?? "",
                              license_plate: vehicle.license_plate ?? "",
                            };
                            const edits = vehicleEdits[vehicle.id] ?? original;
                            const isDirty =
                              edits.make.trim() !== original.make.trim() ||
                              edits.model.trim() !== original.model.trim() ||
                              edits.year.trim() !== original.year.trim() ||
                              edits.license_plate.trim() !== original.license_plate.trim();
                            return (
                              <div
                                key={vehicle.id}
                                className="rounded-lg border border-border bg-muted/10 p-4 shadow-sm transition hover:shadow-md"
                              >
                                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                                  <div>
                                    <p className="text-sm font-semibold text-muted-foreground">
                                      Vehicle #{vehicle.id}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      Current:{' '}
                                      {[original.make, original.model, original.year]
                                        .filter((value) => value && value.trim().length > 0)
                                        .join(" ") || "No saved details"}
                                    </p>
                                  </div>
                                  {isDirty && (
                                    <Badge variant="secondary" className="w-fit bg-primary/10 text-primary">
                                      Unsaved changes
                                    </Badge>
                                  )}
                                </div>
                                <div className="mt-3 grid gap-4 md:grid-cols-2">
                                  <div className="space-y-1">
                                    <Label htmlFor={`vehicle-make-${vehicle.id}`}>Make</Label>
                                    <Input
                                      id={`vehicle-make-${vehicle.id}`}
                                      value={edits.make}
                                      onChange={(event) =>
                                        handleVehicleFieldChange(vehicle.id, "make", event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label htmlFor={`vehicle-model-${vehicle.id}`}>Model</Label>
                                    <Input
                                      id={`vehicle-model-${vehicle.id}`}
                                      value={edits.model}
                                      onChange={(event) =>
                                        handleVehicleFieldChange(vehicle.id, "model", event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label htmlFor={`vehicle-year-${vehicle.id}`}>Year</Label>
                                    <Input
                                      id={`vehicle-year-${vehicle.id}`}
                                      value={edits.year}
                                      onChange={(event) =>
                                        handleVehicleFieldChange(vehicle.id, "year", event.target.value)
                                      }
                                    />
                                  </div>
                                  <div className="space-y-1">
                                    <Label htmlFor={`vehicle-plate-${vehicle.id}`}>Registration</Label>
                                    <Input
                                      id={`vehicle-plate-${vehicle.id}`}
                                      value={edits.license_plate}
                                      onChange={(event) =>
                                        handleVehicleFieldChange(vehicle.id, "license_plate", event.target.value)
                                      }
                                    />
                                  </div>
                                </div>
                                <div className="mt-3 flex flex-col gap-2 md:flex-row md:justify-end">
                                  <Button
                                    type="button"
                                    variant={isDirty ? "default" : "secondary"}
                                    className={!isDirty ? "text-muted-foreground" : undefined}
                                    onClick={() => handleSaveVehicle(vehicle.id)}
                                    disabled={vehicleSavingId === vehicle.id || !isDirty}
                                  >
                                    {vehicleSavingId === vehicle.id ? "Saving..." : "Save Vehicle"}
                                  </Button>
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <Button
                                        type="button"
                                        variant="destructive"
                                        disabled={vehicleDeletingId === vehicle.id}
                                      >
                                        Unassign Vehicle
                                      </Button>
                                    </DialogTrigger>
                                    <DialogContent className="max-w-md">
                                      <DialogHeader>
                                        <DialogTitle>Unassign vehicle?</DialogTitle>
                                        <DialogDescription>
                                          This removes the vehicle from {selectedCustomer?.name ?? "the customer"}.
                                          Jobs that are completed will keep their history, but active jobs must be closed
                                          before unassigning.
                                        </DialogDescription>
                                      </DialogHeader>
                                      <div className="flex justify-end gap-3">
                                        <Button variant="outline">Cancel</Button>
                                        <Button
                                          variant="destructive"
                                          onClick={() => handleUnassignVehicle(vehicle.id)}
                                          disabled={vehicleDeletingId === vehicle.id}
                                        >
                                          {vehicleDeletingId === vehicle.id ? "Unassigning..." : "Confirm"}
                                        </Button>
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                  </div>
                  <div className="flex justify-end gap-3 pt-4">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setEditCustomerOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      className="bg-primary"
                      disabled={updateCustomerMutation.isPending}
                    >
                      {updateCustomerMutation.isPending ? "Saving..." : "Save Changes"}
                    </Button>
                  </div>
                </form>
              )}
            </DialogContent>
          </Dialog>

          <Dialog
            open={deleteCustomerOpen}
            onOpenChange={setDeleteCustomerOpen}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Confirm Deletion</DialogTitle>
                <DialogDescription>
                  Are you sure you want to delete {selectedCustomer?.name ?? "this customer"}?
                  This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <div className="flex justify-end gap-3">
                <Button variant="outline" onClick={() => setDeleteCustomerOpen(false)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleteCustomerMutation.isPending}
                  onClick={() => {
                    if (!selectedCustomer) return;
                    deleteCustomerMutation.mutate(selectedCustomer.id);
                  }}
                >
                  {deleteCustomerMutation.isPending ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
          </div>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            {dashboardStatsLoading ? (
              <div className="text-2xl font-bold text-muted-foreground">Loading...</div>
            ) : dashboardStatsError ? (
              <div className="text-2xl font-bold text-destructive">Error</div>
            ) : (
              <>
                <div className="text-2xl font-bold">{formatDashboardCurrency(totalRevenue)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  For {selectedMonthLabel}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            {dashboardStatsLoading ? (
              <div className="text-2xl font-bold text-muted-foreground">Loading...</div>
            ) : dashboardStatsError ? (
              <div className="text-2xl font-bold text-destructive">Error</div>
            ) : (
              <>
                <div className="text-2xl font-bold">{formatDashboardCurrency(totalExpenses)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  For {selectedMonthLabel}
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            {dashboardStatsLoading ? (
              <div className="text-2xl font-bold text-muted-foreground">Loading...</div>
            ) : dashboardStatsError ? (
              <div className="text-2xl font-bold text-destructive">Error</div>
            ) : (
              <>
                <div className="text-2xl font-bold">{formatDashboardCurrency(netProfit)}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  Margin: <span className={netProfit >= 0 ? "text-success" : "text-destructive"}>{profitMargin}%</span>
                </p>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
            <Wrench className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            {dashboardStatsLoading ? (
              <div className="text-2xl font-bold text-muted-foreground">Loading...</div>
            ) : dashboardStatsError ? (
              <div className="text-2xl font-bold text-destructive">Error</div>
            ) : (
              <>
                <div className="text-2xl font-bold">{activeJobs}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  For {selectedMonthLabel}
                </p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue vs Expenses</CardTitle>
            <CardDescription>Weekly breakdown for {selectedMonthLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardStatsLoading ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                Loading...
              </div>
            ) : dashboardStatsError ? (
              <div className="flex items-center justify-center h-[300px] text-destructive">
                Failed to load revenue and expenses data
              </div>
            ) : weeklyChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No data available for {selectedMonthLabel}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={weeklyChartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="week" />
                  <YAxis />
                  <Tooltip 
                    formatter={(value: number) => formatDashboardCurrency(value)}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="revenue" 
                    stroke="hsl(var(--chart-1))" 
                    strokeWidth={2}
                    name="Revenue"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="expenses" 
                    stroke="hsl(var(--chart-3))" 
                    strokeWidth={2}
                    name="Expenses"
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job Status Overview</CardTitle>
            <CardDescription>Job status distribution for {selectedMonthLabel}</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboardStatsLoading ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                Loading...
              </div>
            ) : dashboardStatsError ? (
              <div className="flex items-center justify-center h-[300px] text-destructive">
                Failed to load job status data
              </div>
            ) : jobStatusChartData.length === 0 ? (
              <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                No jobs found for {selectedMonthLabel}
              </div>
            ) : (
              <ResponsiveContainer width="100%" height={350}>
                <PieChart>
                  <Pie
                    data={jobStatusChartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={({ value, percent }) => `${value} (${(percent * 100).toFixed(0)}%)`}
                    outerRadius={120}
                    innerRadius={60}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {jobStatusChartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => [value, "Jobs"]}
                    labelFormatter={(label) => `Status: ${label}`}
                  />
                  <Legend 
                    formatter={(value) => value}
                    iconType="circle"
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions & Recent Activity */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
            <CardDescription>Frequently used operations</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => navigate("/jobs")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Create New Job
            </Button>
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => navigate("/inventory")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add Inventory Item
            </Button>
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => navigate("/expenses")}
            >
              <Plus className="mr-2 h-4 w-4" />
              Record Expense
            </Button>
            <Button 
              variant="outline" 
              className="w-full justify-start"
              onClick={() => navigate("/reports")}
            >
              <BarChart3 className="mr-2 h-4 w-4" />
              View Reports
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
            <CardDescription>Latest job activities</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {recentJobsLoading ? (
              <div className="text-sm text-muted-foreground text-center py-4">Loading jobs...</div>
            ) : recentJobsError ? (
              <div className="text-sm text-destructive text-center py-4">Failed to load jobs</div>
            ) : recentJobs.length === 0 ? (
              <div className="text-sm text-muted-foreground text-center py-4">No jobs found</div>
            ) : (
              recentJobs.map((job) => (
                <div key={job.id} className="flex items-center gap-3">
                  {getJobStatusIcon(job.job_status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{formatJobTitle(job)}</p>
                    <p className="text-xs text-muted-foreground">
                      {job.job_status} • {formatRelativeTime(job.created_at)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
