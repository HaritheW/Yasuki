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
} from "lucide-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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

type CreateCustomerPayload = {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
};

const CUSTOMERS_QUERY_KEY = ["customers"];

const Dashboard = () => {
  const [addCustomerOpen, setAddCustomerOpen] = useState(false);
  const [viewCustomersOpen, setViewCustomersOpen] = useState(false);
  const [customerDetailOpen, setCustomerDetailOpen] = useState(false);
  const [editCustomerOpen, setEditCustomerOpen] = useState(false);
  const [deleteCustomerOpen, setDeleteCustomerOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

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

  const totalRevenue = revenueData.reduce((sum, item) => sum + item.revenue, 0);
  const totalExpenses = revenueData.reduce((sum, item) => sum + item.expenses, 0);
  const netProfit = totalRevenue - totalExpenses;
  const profitMargin = ((netProfit / totalRevenue) * 100).toFixed(1);

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

      {/* Key Metrics */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <DollarSign className="h-4 w-4 text-success" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalRevenue.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <TrendingUp className="h-3 w-3 text-success" />
              <span className="text-success">+12.5%</span> from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-destructive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalExpenses.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
              <TrendingUp className="h-3 w-3 text-warning" />
              <span className="text-warning">+5.2%</span> from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Profit</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${netProfit.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground mt-1">
              Margin: <span className="text-success font-semibold">{profitMargin}%</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Active Jobs</CardTitle>
            <Wrench className="h-4 w-4 text-info" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">23</div>
            <p className="text-xs text-muted-foreground mt-1">
              <span className="text-success">18 completed</span> this week
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Revenue vs Expenses</CardTitle>
            <CardDescription>Monthly comparison for the past 6 months</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={revenueData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="month" />
                <YAxis />
                <Tooltip />
                <Line type="monotone" dataKey="revenue" stroke="hsl(var(--chart-1))" strokeWidth={2} />
                <Line type="monotone" dataKey="expenses" stroke="hsl(var(--chart-3))" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Job Status Overview</CardTitle>
            <CardDescription>Weekly job completion status</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={jobData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="completed" fill="hsl(var(--chart-2))" />
                <Bar dataKey="pending" fill="hsl(var(--chart-3))" />
              </BarChart>
            </ResponsiveContainer>
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
            <Button variant="outline" className="w-full justify-start">
              <Plus className="mr-2 h-4 w-4" />
              Create New Job
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <Plus className="mr-2 h-4 w-4" />
              Add Inventory Item
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <Plus className="mr-2 h-4 w-4" />
              Record Expense
            </Button>
            <Button variant="outline" className="w-full justify-start">
              <Plus className="mr-2 h-4 w-4" />
              Add New Customer
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Recent Jobs</CardTitle>
            <CardDescription>Latest job activities</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="flex-1">
                <p className="text-sm font-medium">Oil Change - Honda Civic</p>
                <p className="text-xs text-muted-foreground">Completed 2 hours ago</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-warning" />
              <div className="flex-1">
                <p className="text-sm font-medium">Brake Repair - Toyota Camry</p>
                <p className="text-xs text-muted-foreground">In progress</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-5 w-5 text-success" />
              <div className="flex-1">
                <p className="text-sm font-medium">Transmission Service - Ford F-150</p>
                <p className="text-xs text-muted-foreground">Completed yesterday</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Clock className="h-5 w-5 text-warning" />
              <div className="flex-1">
                <p className="text-sm font-medium">Engine Diagnostic - BMW 3 Series</p>
                <p className="text-xs text-muted-foreground">Pending</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Dashboard;
