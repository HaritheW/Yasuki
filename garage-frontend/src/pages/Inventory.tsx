import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Plus, Search, Edit, AlertCircle, Package } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState } from "react";
import { useToast } from "@/hooks/use-toast";

const mockInventory = [
  { name: "Engine Oil 5W-30", type: "Consumables", quantity: 45, unit: "Liters", cost: "$8.50", status: "In Stock", remarks: "Premium grade oil for modern engines" },
  { name: "Brake Pads", type: "Non-Consumables", quantity: 12, unit: "Sets", cost: "$45.00", status: "In Stock", remarks: "Ceramic brake pads, OEM quality" },
  { name: "Air Filter", type: "Non-Consumables", quantity: 8, unit: "Units", cost: "$15.00", status: "Low Stock", remarks: "Reorder needed - minimum 20 units" },
  { name: "Coolant", type: "Bulk", quantity: 150, unit: "Liters", cost: "$6.00", status: "In Stock", remarks: "All-season coolant mix" },
  { name: "Spark Plugs", type: "Non-Consumables", quantity: 3, unit: "Sets", cost: "$25.00", status: "Low Stock", remarks: "Urgent reorder - iridium type" },
];

const Inventory = () => {
  const [open, setOpen] = useState(false);
  const [addStockOpen, setAddStockOpen] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<typeof mockInventory[0] | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const { toast } = useToast();

  const filteredInventory = mockInventory
    .filter(item => statusFilter === "all" || item.status === statusFilter)
    .filter(item => typeFilter === "all" || item.type === typeFilter);

  const handleAddStock = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Stock Added",
      description: "Stock has been added successfully.",
    });
    setAddStockOpen(false);
  };

  const handleDelete = () => {
    toast({
      title: "Item Deleted",
      description: `${selectedItem?.name} has been deleted successfully.`,
    });
    setDeleteOpen(false);
    setDetailOpen(false);
  };

  const handleEdit = (e: React.FormEvent) => {
    e.preventDefault();
    toast({
      title: "Item Updated",
      description: `${selectedItem?.name} has been updated successfully.`,
    });
    setEditOpen(false);
    setDetailOpen(false);
  };

  const getStatusColor = (status: string) => {
    return status === "Low Stock" 
      ? "bg-warning text-warning-foreground" 
      : "bg-success text-success-foreground";
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case "Consumables":
        return "bg-info text-info-foreground";
      case "Bulk":
        return "bg-primary text-primary-foreground";
      default:
        return "bg-secondary text-secondary-foreground";
    }
  };

  const handleRowClick = (item: typeof mockInventory[0]) => {
    setSelectedItem(item);
    setDetailOpen(true);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Inventory</h1>
          <p className="text-muted-foreground">Manage your garage inventory and stock</p>
        </div>
        <div className="flex gap-2">
          <Dialog open={addStockOpen} onOpenChange={setAddStockOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Package className="mr-2 h-4 w-4" />
                Add Stock
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add Stock to Existing Item</DialogTitle>
                <DialogDescription>Increase the quantity of an existing inventory item</DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddStock} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="existingItem">Select Item</Label>
                  <Select>
                    <SelectTrigger id="existingItem">
                      <SelectValue placeholder="Choose an item" />
                    </SelectTrigger>
                    <SelectContent>
                      {mockInventory.map((item, idx) => (
                        <SelectItem key={idx} value={item.name}>
                          {item.name} (Current: {item.quantity} {item.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="addQuantity">Quantity to Add</Label>
                  <Input id="addQuantity" type="number" placeholder="0" required />
                </div>
                <div className="flex justify-end gap-3">
                  <Button type="button" variant="outline" onClick={() => setAddStockOpen(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" className="bg-primary">
                    Add Stock
                  </Button>
                </div>
              </form>
            </DialogContent>
          </Dialog>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-primary hover:bg-primary/90">
                <Plus className="mr-2 h-4 w-4" />
                Add Item
              </Button>
            </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add Inventory Item</DialogTitle>
              <DialogDescription>Add a new item to your inventory</DialogDescription>
            </DialogHeader>
            <form className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="itemName">Item Name</Label>
                <Input id="itemName" placeholder="Engine Oil 5W-30" required />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="type">Type</Label>
                  <Select>
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="consumables">Consumables</SelectItem>
                      <SelectItem value="bulk">Bulk</SelectItem>
                      <SelectItem value="non-consumables">Non-Consumables</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="unit">Unit</Label>
                  <Select>
                    <SelectTrigger id="unit">
                      <SelectValue placeholder="Select unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="liters">Liters</SelectItem>
                      <SelectItem value="units">Units</SelectItem>
                      <SelectItem value="sets">Sets</SelectItem>
                      <SelectItem value="pieces">Pieces</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="quantity">Quantity</Label>
                  <Input id="quantity" type="number" placeholder="0" required />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="cost">Unit Cost ($)</Label>
                  <Input id="cost" type="number" step="0.01" placeholder="0.00" required />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="minStock">Minimum Stock Level (Optional)</Label>
                <Input id="minStock" type="number" placeholder="10" />
              </div>

              <div className="space-y-2">
                <Label htmlFor="remarks">Remarks (Optional)</Label>
                <Input id="remarks" placeholder="Add notes about the item..." />
              </div>

              <div className="flex justify-end gap-3 pt-4">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" className="bg-primary">
                  Add Item
                </Button>
              </div>
            </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Search inventory..." className="pl-10" />
            </div>
            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="Consumables">Consumables</SelectItem>
                <SelectItem value="Bulk">Bulk</SelectItem>
                <SelectItem value="Non-Consumables">Non-Consumables</SelectItem>
              </SelectContent>
            </Select>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-[180px]">
                <SelectValue placeholder="Filter by status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="In Stock">In Stock</SelectItem>
                <SelectItem value="Low Stock">Low Stock</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="p-3 text-left text-sm font-medium">Item Name</th>
                  <th className="p-3 text-left text-sm font-medium">Type</th>
                  <th className="p-3 text-left text-sm font-medium">Quantity</th>
                  <th className="p-3 text-left text-sm font-medium">Unit Cost</th>
                  <th className="p-3 text-left text-sm font-medium">Status</th>
                  <th className="p-3 text-left text-sm font-medium">Remarks</th>
                </tr>
              </thead>
              <tbody>
                {filteredInventory.map((item, index) => (
                  <tr 
                    key={index} 
                    className="border-b hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => handleRowClick(item)}
                  >
                    <td className="p-3 font-medium">{item.name}</td>
                    <td className="p-3">
                      <Badge className={getTypeColor(item.type)}>{item.type}</Badge>
                    </td>
                    <td className="p-3">
                      <span className={item.status === "Low Stock" ? "text-warning font-semibold" : ""}>
                        {item.quantity} {item.unit}
                        {item.status === "Low Stock" && <AlertCircle className="inline ml-1 h-4 w-4" />}
                      </span>
                    </td>
                    <td className="p-3 font-semibold">{item.cost}</td>
                    <td className="p-3">
                      <Badge className={getStatusColor(item.status)}>{item.status}</Badge>
                    </td>
                    <td className="p-3 text-muted-foreground text-sm max-w-[200px] truncate">{item.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Item Detail Modal */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Inventory Item Details</DialogTitle>
            <DialogDescription>Complete information for {selectedItem?.name}</DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground">Item Name</Label>
                  <p className="font-semibold">{selectedItem.name}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Type</Label>
                  <div className="mt-1">
                    <Badge className={getTypeColor(selectedItem.type)}>{selectedItem.type}</Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Quantity</Label>
                  <p className="font-semibold">{selectedItem.quantity} {selectedItem.unit}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Unit Cost</Label>
                  <p className="font-semibold">{selectedItem.cost}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground">Status</Label>
                  <div className="mt-1">
                    <Badge className={getStatusColor(selectedItem.status)}>{selectedItem.status}</Badge>
                  </div>
                </div>
                <div>
                  <Label className="text-muted-foreground">Unit</Label>
                  <p className="font-semibold">{selectedItem.unit}</p>
                </div>
                <div className="col-span-2">
                  <Label className="text-muted-foreground">Remarks</Label>
                  <p className="font-semibold">{selectedItem.remarks}</p>
                </div>
              </div>

              <div className="flex gap-3 pt-4 border-t">
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
                  onClick={() => {
                    setDetailOpen(false);
                    setDeleteOpen(true);
                  }}
                >
                  Delete
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Item Modal */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Item</DialogTitle>
            <DialogDescription>Update stock quantity and remarks for {selectedItem?.name}</DialogDescription>
          </DialogHeader>
          {selectedItem && (
            <form onSubmit={handleEdit} className="space-y-4">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="editName">Item Name</Label>
                  <Input id="editName" defaultValue={selectedItem.name} disabled className="bg-muted" />
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editType">Type</Label>
                    <Input id="editType" defaultValue={selectedItem.type} disabled className="bg-muted" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editUnit">Unit</Label>
                    <Input id="editUnit" defaultValue={selectedItem.unit} disabled className="bg-muted" />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="editQuantity">Quantity</Label>
                    <Input id="editQuantity" type="number" defaultValue={selectedItem.quantity} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="editStatus">Status</Label>
                    <Select defaultValue={selectedItem.status}>
                      <SelectTrigger id="editStatus">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="In Stock">In Stock</SelectItem>
                        <SelectItem value="Low Stock">Low Stock</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editCost">Unit Cost</Label>
                  <Input id="editCost" defaultValue={selectedItem.cost} disabled className="bg-muted" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="editRemarks">Remarks</Label>
                  <Input id="editRemarks" defaultValue={selectedItem.remarks} />
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
              Are you sure you want to delete {selectedItem?.name}? This action cannot be undone.
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

export default Inventory;
