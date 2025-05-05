'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation'; // Use App Router's navigation
import { ScanLine, Package, BarChart2, LogIn, UserPlus, LogOut, Settings, Home, FileText } from 'lucide-react'; // Import FileText
import { Button } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";


const navItems = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/upload', label: 'Upload', icon: ScanLine },
  { href: '/inventory', label: 'Inventory', icon: Package },
  { href: '/reports', label: 'Reports', icon: BarChart2 },
  { href: '/invoices', label: 'Invoices', icon: FileText }, // Use imported FileText
];

export default function Navigation() {
  const pathname = usePathname();
  const { user, logout, loading } = useAuth();
  const router = useRouter();

  const handleLogout = () => {
    logout();
    router.push('/login'); // Redirect to login after logout
  };

  const getInitials = (name: string | undefined) => {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase();
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm" style={{ '--header-height': '4rem' } as React.CSSProperties}>
      <div className="container flex h-16 items-center justify-between">
        {/* Logo/Brand */}
        <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg">
          {/* Optional: Add a logo SVG here */}
          <Package className="h-6 w-6" />
          <span>InvoTrack</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                pathname === item.href
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Auth Buttons / User Menu */}
        <div className="flex items-center gap-2">
          {loading ? (
            <div className="h-8 w-20 animate-pulse rounded-md bg-muted"></div> // Skeleton loader
          ) : user ? (
             <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="relative h-8 w-8 rounded-full">
                  <Avatar className="h-8 w-8">
                    {/* Add AvatarImage if you have user profile pictures */}
                    {/* <AvatarImage src="/avatars/01.png" alt={user.username} /> */}
                    <AvatarFallback>{getInitials(user.username)}</AvatarFallback>
                  </Avatar>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56" align="end" forceMount>
                <DropdownMenuLabel className="font-normal">
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{user.username}</p>
                    <p className="text-xs leading-none text-muted-foreground">
                      {user.email}
                    </p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/settings')}> {/* Navigate to settings */}
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Settings</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout}>
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <>
              <Button variant="outline" size="sm" asChild>
                <Link href="/login">
                  <LogIn className="mr-1 h-4 w-4" /> Login
                </Link>
              </Button>
              <Button size="sm" asChild>
                <Link href="/register">
                   <UserPlus className="mr-1 h-4 w-4" /> Register
                </Link>
              </Button>
            </>
          )}
        </div>

        {/* Mobile Navigation Trigger (Example - Implement Sheet if needed) */}
        {/* <div className="md:hidden">
          <Button variant="ghost" size="icon">
            <Menu className="h-6 w-6" />
          </Button>
        </div> */}
      </div>

      {/* Bottom Navigation for Mobile */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 flex h-16 items-center justify-around border-t bg-background shadow-up md:hidden">
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "flex flex-col items-center justify-center gap-1 p-2 text-xs font-medium transition-colors w-full",
               pathname === item.href
                ? "text-primary"
                : "text-muted-foreground hover:text-primary"
            )}
          >
            <item.icon className="h-5 w-5" />
            <span>{item.label}</span>
          </Link>
        ))}
         {/* Add User profile icon for mobile */}
         {user && !loading && (
           <DropdownMenu>
              <DropdownMenuTrigger asChild>
                 <button className={cn(
                    "flex flex-col items-center justify-center gap-1 p-2 text-xs font-medium transition-colors w-full",
                     pathname === '/settings' // Example active state for settings
                      ? "text-primary"
                      : "text-muted-foreground hover:text-primary"
                  )}>
                    <Avatar className="h-6 w-6">
                       <AvatarFallback>{getInitials(user.username)}</AvatarFallback>
                    </Avatar>
                    <span>Profile</span>
                 </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent className="w-56 mb-2" align="end" forceMount>
                 {/* Same content as desktop dropdown */}
                 <DropdownMenuLabel className="font-normal">
                    <div className="flex flex-col space-y-1">
                       <p className="text-sm font-medium leading-none">{user.username}</p>
                       <p className="text-xs leading-none text-muted-foreground">
                         {user.email}
                       </p>
                    </div>
                 </DropdownMenuLabel>
                 <DropdownMenuSeparator />
                 <DropdownMenuItem onClick={() => router.push('/settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                 </DropdownMenuItem>
                 <DropdownMenuSeparator />
                 <DropdownMenuItem onClick={handleLogout}>
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                 </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
         )}
      </nav>
       {/* Add padding to the bottom of the main content area to prevent overlap with mobile nav */}
      <div className="pb-16 md:pb-0"></div>

    </header>
  );
}
