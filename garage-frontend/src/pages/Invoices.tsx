import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, FileText, Mail, Download, Plus, Edit } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";

const mockInvoices = [
  { id: "INV-001", customer: "John Smith", date: "2024-01-15", amount: 250_000, status: "Paid", remarks: "Payment received via bank transfer" },
  { id: "INV-002", customer: "Sarah Williams", date: "2024-01-14", amount: 180_000, status: "Pending", remarks: "Customer requested 7-day extension" },
  { id: "INV-003", customer: "Robert Brown", date: "2024-01-13", amount: 450_000, status: "Paid", remarks: "Cash payment, receipt issued" },
  { id: "INV-004", customer: "Emily Davis", date: "2024-01-12", amount: 320_000, status: "Overdue", remarks: "Follow up call scheduled" },
];

const formatCurrency = (value: number) =>
  new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: "LKR",
    maximumFractionDigits: 2,
  }).format(value);

const Invoices = () => {
  const [emailOpen, setEmailOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [addChargeOpen, setAddChargeOpen] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState("");
  const [selectedInvoiceDetail, setSelectedInvoiceDetail] = useState<typeof mockInvoices[0] | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [entryMethod, setEntryMethod] = useState("manual");
  const [chargeType, setChargeType] = useState("charge");
  const [charges, setCharges] = useState([
    { category: "Labor", amount: 150, quantity: 1, isInventoryItem: false },
    { category: "Parts", amount: 100, quantity: 1, isInventoryItem: false },
  ]);
  const [reductions, setReductions] = useState([
    { category: "Discount", amount: 20 },
  ]);
  
  const mockInventory = [
    { name: "Engine Oil 5W-30", unit: "Liters" },
    { name: "Brake Pads", unit: "Sets" },
    { name: "Air Filter", unit: "Units" },
    { name: "Coolant", unit: "Liters" },
    { name: "Spark Plugs", unit: "Sets" },
  ];
  const { toast } = useToast();

  useEffect(() => {
    if (!addChargeOpen) {
      setEntryMethod("manual");
      setChargeType("charge");
    }
  }, [addChargeOpen]);

  const filteredInvoices = statusFilter === "all" 
    ? mockInvoices 
    : mockInvoices.filter(inv => inv.status === statusFilter);

  const handleSendEmail = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Invoice Sent",
      description: `Invoice ${selectedInvoice} has been sent successfully.`,
    });
    setEmailOpen(false);
  };

  const handleDelete = () => {
    toast({
      title: "Invoice Deleted",
      description: `Invoice ${selectedInvoiceDetail?.id} has been deleted successfully.`,
    });
    setDeleteOpen(false);
    setDetailOpen(false);
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Invoice Updated",
      description: `Invoice ${selectedInvoiceDetail?.id} has been updated successfully.`,
    });
    setEditOpen(false);
    setDetailOpen(false);
  };

  const handleAddCharge = (e: React.FormEvent) => {
    e.preventDefault();
    const formData = new FormData(e.target as HTMLFormElement);
    
    if (chargeType === 'charge') {
      if (entryMethod === 'manual') {
        const category = formData.get('category') as string;
        const amount = parseFloat(formData.get('amount') as string);
        setCharges([...charges, { category, amount, quantity: 1, isInventoryItem: false }]);
      } else {
        const inventoryItem = formData.get('inventoryItem') as string;
        const quantity = parseFloat(formData.get('quantity') as string);
        const amount = parseFloat(formData.get('itemCost') as string);
        setCharges([...charges, { category: inventoryItem, amount, quantity, isInventoryItem: true }]);
      }
    } else {
      const category = formData.get('category') as string;
      const amount = parseFloat(formData.get('amount') as string);
      setReductions([...reductions, { category, amount }]);
    }
    
    toast({
      title: chargeType === 'charge' ? "Charge Added" : "Reduction Added",
      description: "Item has been added successfully.",
    });
    setAddChargeOpen(false);
  };
  
  const handleSaveInvoiceChanges = () => {
    toast({
      title: "Invoice Saved",
      description: "All charges and reductions have been saved successfully.",
    });
  };

  const totalCharges = charges.reduce((sum, c) => sum + (c.amount * c.quantity), 0);
  const totalReductions = reductions.reduce((sum, r) => sum + r.amount, 0);
  const finalAmount = totalCharges - totalReductions;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "Paid":
        return "bg-success text-success-foreground";
      case "Pending":
        return "bg-warning text-warning-foreground";
      case "Overdue":
        return "bg-destructive text-destructive-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-foreground">Manage Invoices</h1>
        <p className="text-muted-foreground">View and manage customer invoices</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search invoices..." className="pl-10" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Paid">Paid</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Overdue">Overdue</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Invoice ID</th>
                  <th className="p-3 text-left text-sm font-medium">Customer</th>
                  <th className="p-3 text-left text-sm font-medium">Date</th>
                  <th className="p-3 text-left text-sm font-medium">Amount</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Remarks</th>
                  <th className="p-3 text-left text-sm font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredInvoices.map((invoice) => (
                  <tr 
                    key={invoice.id} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => {
                      setSelectedInvoiceDetail(invoice);
                      setDetailOpen(true);
                    }}
                  >
                    <td className="p-3 font-medium">{invoice.id}</td>
                    <td className="p-3">{invoice.customer}</td>
                    <td className="p-3 text-muted-foreground">{invoice.date}</td>
                    <td className="p-3 font-semibold">{formatCurrency(invoice.amount)}</td>
                    <td className="p-3">
                      <Badge className={getStatusColor(invoice.status)}>
                        {invoice.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-muted-foreground text-sm max-w-[200px] truncate">{invoice.remarks}</td>
                    <td className="p-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex gap-2">
                        <Button variant="ghost" size="icon" title="View">
                          <FileText className="h-4 w-4" />
                        </Button>
                        <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" title="Send Email" onClick={() => setSelectedInvoice(invoice.id)}>
                              <Mail className="h-4 w-4" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Send Invoice via Email</DialogTitle>
                              <DialogDescription>Send {invoice.id} to the customer's email address</DialogDescription>
                            </DialogHeader>
                            <form onSubmit={handleSendEmail} className="space-y-4">
                              <div className="space-y-2">
                                <Label htmlFor="email">Email Address</Label>
                                <Input id="email" type="email" placeholder="customer@example.com" required />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="subject">Subject</Label>
                                <Input id="subject" defaultValue={`Invoice ${invoice.id} from Garage`} required />
                              </div>
                              <div className="space-y-2">
                                <Label htmlFor="message">Message (Optional)</Label>
                                <Input id="message" placeholder="Add a custom message..." />
                              </div>
                              <div className="flex justify-end gap-3">
                                <Button type="button" variant="outline" onClick={() => setEmailOpen(false)}>
                                  Cancel
                                </Button>
                                <Button type="submit" className="bg-primary">
                                  Send Invoice
                                </Button>
                              </div>
                            </form>
                          </DialogContent>
                        </Dialog>
                        <Button variant="ghost" size="icon" title="Download">
                          <Download className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Invoice Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Invoice</DialogTitle>
            <DialogDescription>Invoice {selectedInvoiceDetail?.id}</DialogDescription>
          </DialogHeader>
          {selectedInvoiceDetail && (
            <div className="space-y-6">
              {/* Invoice Header */}
              <div className="flex justify-between items-start pb-4 border-b">
                <div>
                  <h2 className="text-2xl font-bold">{selectedInvoiceDetail.id}</h2>
                  <p className="text-muted-foreground">{selectedInvoiceDetail.date}</p>
                </div>
                <div className="flex flex-col items-end gap-2">
                  <Badge className={getStatusColor(selectedInvoiceDetail.status)}>
                    {selectedInvoiceDetail.status}
                  </Badge>
                  <div className="text-right">
                    <Label className="text-xs text-muted-foreground uppercase tracking-wide">Invoice total</Label>
                    <p className="font-semibold text-lg">{formatCurrency(selectedInvoiceDetail.amount)}</p>
                  </div>
                </div>
              </div>

              {/* Customer Info */}
              <div>
                <Label className="text-muted-foreground">Bill To:</Label>
                <p className="font-semibold text-lg">{selectedInvoiceDetail.customer}</p>
              </div>

              {/* Charges Section */}
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <h3 className="font-semibold text-lg">Charges</h3>
                  <Button 
                    size="sm" 
                    variant="outline"
                    onClick={() => setAddChargeOpen(true)}
                  >
                    <Plus className="h-4 w-4 mr-1" />
                    Add
                  </Button>
                </div>
                <div className="border rounded-md">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left text-sm font-medium">Category</th>
                        <th className="p-3 text-right text-sm font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {charges.map((charge, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-3">
                            {charge.category}
                            {charge.isInventoryItem && (
                              <span className="text-xs text-muted-foreground ml-2">
                                (Qty: {charge.quantity})
                              </span>
                            )}
                          </td>
                          <td className="p-3 text-right">
                            {formatCurrency(charge.amount * charge.quantity)}
                          </td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="p-3">Total Charges</td>
                        <td className="p-3 text-right">{formatCurrency(totalCharges)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Reductions Section */}
              <div className="space-y-3">
                <h3 className="font-semibold text-lg">Reductions</h3>
                <div className="border rounded-md">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="p-3 text-left text-sm font-medium">Category</th>
                        <th className="p-3 text-right text-sm font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reductions.map((reduction, idx) => (
                        <tr key={idx} className="border-b">
                          <td className="p-3">{reduction.category}</td>
                          <td className="p-3 text-right">{formatCurrency(-reduction.amount)}</td>
                        </tr>
                      ))}
                      <tr className="font-semibold">
                        <td className="p-3">Total Reductions</td>
                        <td className="p-3 text-right">{formatCurrency(-totalReductions)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Final Amount */}
              <div className="pt-4 border-t">
                <div className="flex justify-between items-center text-xl font-bold">
                  <span>Final Amount</span>
                  <span>{formatCurrency(finalAmount)}</span>
                </div>
              </div>

              {/* Remarks */}
              <div className="pt-4 border-t">
                <Label className="text-muted-foreground">Remarks</Label>
                <p className="mt-1">{selectedInvoiceDetail.remarks}</p>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t">
                <Button 
                  variant="default"
                  className="flex-1"
                  onClick={handleSaveInvoiceChanges}
                >
                  Save Changes
                </Button>
                <Button 
                  variant="outline" 
                  className="flex-1"
                  onClick={() => {
                    setDetailOpen(false);
                    setEditOpen(true);
                  }}
                >
                  <Edit className="mr-2 h-4 w-4" />
                  Edit
                </Button>
                <Button 
                  variant="destructive" 
                  className="flex-1"
                  onClick={() => setDeleteOpen(true)}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Add Charge/Reduction Dialog */}
      <Dialog open={addChargeOpen} onOpenChange={setAddChargeOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Add Charge or Reduction</DialogTitle>
            <DialogDescription>Add a new item to the invoice</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddCharge} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="chargeType">Type</Label>
              <Select name="chargeType" value={chargeType} onValueChange={(value) => {
                setChargeType(value);
                if (value === "reduction") setEntryMethod("manual");
              }}>
                <SelectTrigger id="chargeType">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="charge">Charge</SelectItem>
                  <SelectItem value="reduction">Reduction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-4 p-4 border rounded-md">
              {chargeType === "charge" && (
                <>
                  <Label>Entry Method</Label>
                  <Select name="entryType" value={entryMethod} onValueChange={setEntryMethod}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="manual">Manual Entry</SelectItem>
                      <SelectItem value="inventory">From Inventory</SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
              
              {entryMethod === "manual" ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="category">Category</Label>
                    <Input id="category" name="category" placeholder="e.g., Labor, Parts, Discount" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (LKR)</Label>
                    <Input id="amount" name="amount" type="number" step="0.01" placeholder="0.00" />
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="inventoryItem">Select Item</Label>
                    <Select name="inventoryItem">
                      <SelectTrigger id="inventoryItem">
                        <SelectValue placeholder="Choose inventory item" />
                      </SelectTrigger>
                      <SelectContent>
                        {mockInventory.map((item, idx) => (
                          <SelectItem key={idx} value={item.name}>
                            {item.name} ({item.unit})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="quantity">Quantity Used</Label>
                    <Input id="quantity" name="quantity" type="number" step="0.01" placeholder="0" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="itemCost">Cost per Unit (LKR)</Label>
                    <Input id="itemCost" name="itemCost" type="number" step="0.01" placeholder="0.00" />
                  </div>
                </div>
              )}
            </div>
            
            <div className="flex justify-end gap-3">
              <Button type="button" variant="outline" onClick={() => setAddChargeOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="bg-primary">
                Add
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Invoice Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Invoice</DialogTitle>
            <DialogDescription>Update invoice details for {selectedInvoiceDetail?.id}</DialogDescription>
          </DialogHeader>
          {selectedInvoiceDetail && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="editCustomer">Customer</Label>
                  <Input id="editCustomer" defaultValue={selectedInvoiceDetail.customer} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editDate">Date</Label>
                  <Input id="editDate" type="date" defaultValue={selectedInvoiceDetail.date} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editAmount">Amount</Label>
                  <Input id="editAmount" defaultValue={selectedInvoiceDetail.amount} disabled />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editStatus">Status</Label>
                  <Select defaultValue={selectedInvoiceDetail.status}>
                    <SelectTrigger id="editStatus">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Paid">Paid</SelectItem>
                      <SelectItem value="Pending">Pending</SelectItem>
                      <SelectItem value="Overdue">Overdue</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="editRemarks">Remarks</Label>
                  <Textarea id="editRemarks" defaultValue={selectedInvoiceDetail.remarks} rows={3} />
                </div>
              </div>
              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setEditOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary">
                  Save Changes
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Deletion</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete invoice {selectedInvoiceDetail?.id}? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3">
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete}>
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Invoices;
