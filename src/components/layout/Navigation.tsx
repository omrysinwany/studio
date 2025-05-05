
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation'; // Use App Router's navigation
import { ScanLine, Package, BarChart2, LogIn, UserPlus, LogOut, Settings, Home, FileText, Menu, Palette, Sun, Moon } from 'lucide-react'; // Added Menu, Palette, Sun, Moon
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
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuPortal,
  DropdownMenuSubContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'; // Import Sheet components
import React, { useState } from 'react';
import { useTheme } from 'next-themes'; // Import useTheme


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
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false); // State for mobile sheet
  const { theme, setTheme, themes } = useTheme(); // Theme hook


  const handleLogout = () => {
    logout();
    router.push('/login'); // Redirect to login after logout
  };

   const handleMobileNavClick = (href: string) => {
      router.push(href);
      setIsMobileSheetOpen(false); // Close sheet on navigation
   };

  const getInitials = (name: string | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2); // Limit to 2 initials
  };

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm" style={{ '--header-height': '4rem' } as React.CSSProperties}>
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        {/* Logo/Brand */}
        <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg hover:opacity-80 transition-opacity">
          {/* Optional: Add a logo SVG here */}
          <Package className="h-6 w-6 text-primary" /> {/* Ensure logo has primary color */}
          <span className="text-primary">InvoTrack</span> {/* Ensure text has primary color */}
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium transition-colors duration-150 ease-in-out", // Adjusted gap and duration
                pathname === item.href
                  ? "bg-accent text-accent-foreground" // Use accent for active state
                  : "text-muted-foreground hover:bg-muted hover:text-foreground" // Use muted for inactive hover
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          ))}
        </nav>

        {/* Auth Buttons / User Menu / Theme Toggle / Mobile Trigger */}
        <div className="flex items-center gap-2">
           {/* Theme Toggle (Desktop) */}
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <Button variant="ghost" size="icon" className='hidden md:inline-flex'>
                  <Palette className="h-[1.2rem] w-[1.2rem]" />
                  <span className="sr-only">Toggle theme</span>
               </Button>
             </DropdownMenuTrigger>
             <DropdownMenuContent align="end">
               <DropdownMenuLabel>Theme</DropdownMenuLabel>
               <DropdownMenuSeparator />
               <DropdownMenuRadioGroup value={theme} onValueChange={setTheme}>
                 <DropdownMenuRadioItem value="light">
                   <Sun className="mr-2 h-4 w-4" /> Light
                 </DropdownMenuRadioItem>
                 <DropdownMenuRadioItem value="dark">
                   <Moon className="mr-2 h-4 w-4" /> Dark
                 </DropdownMenuRadioItem>
                 <DropdownMenuRadioItem value="system">
                   <Settings className="mr-2 h-4 w-4" /> System
                 </DropdownMenuRadioItem>
               </DropdownMenuRadioGroup>
             </DropdownMenuContent>
           </DropdownMenu>

          {/* Desktop Auth/User Menu */}
          <div className="hidden md:flex items-center gap-2">
              {loading ? (
                <div className="h-8 w-20 animate-pulse rounded-md bg-muted"></div> // Skeleton loader
              ) : user ? (
                 <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full"> {/* Slightly larger */}
                      <Avatar className="h-9 w-9">
                        {/* Add AvatarImage if you have user profile pictures */}
                        {/* <AvatarImage src="/avatars/01.png" alt={user.username} /> */}
                        <AvatarFallback className="text-xs">{getInitials(user.username)}</AvatarFallback> {/* Smaller text */}
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
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>Log out</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                   <Button variant="ghost" size="sm" asChild> {/* Ghost button for login */}
                    <Link href="/login">
                       {/* Wrap icon and text in a single span */}
                       <span className="flex items-center">
                         <LogIn className="mr-1 h-4 w-4" /> Login
                       </span>
                    </Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link href="/register">
                       {/* Wrap icon and text in a single span */}
                       <span className="flex items-center">
                         <UserPlus className="mr-1 h-4 w-4" /> Register
                       </span>
                    </Link>
                  </Button>
                </>
              )}
          </div>

           {/* Mobile Navigation Trigger */}
            <div className="md:hidden">
              <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <Menu className="h-6 w-6" />
                     <span className="sr-only">Toggle Navigation</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-full max-w-xs p-4 flex flex-col"> {/* Full width, flex col */}
                   {/* Top section: Mobile Logo/Brand & Nav */}
                   <div>
                      <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg mb-6" onClick={() => setIsMobileSheetOpen(false)}>
                          <Package className="h-6 w-6 text-primary" />
                          <span className="text-primary">InvoTrack</span>
                      </Link>
                      <nav className="flex flex-col gap-2 mb-6">
                        {navItems.map((item) => (
                          <Button
                             key={item.href}
                             variant={pathname === item.href ? 'secondary' : 'ghost'} // Use secondary for active
                             className="justify-start gap-2 text-base py-3" // Larger text, padding
                             onClick={() => handleMobileNavClick(item.href)}
                          >
                             <item.icon className="h-5 w-5" /> {/* Slightly larger icons */}
                             {item.label}
                          </Button>
                        ))}
                      </nav>
                   </div>

                    {/* Bottom section: Auth/User & Theme */}
                    <div className="mt-auto border-t pt-4 space-y-4">
                        {/* Mobile Auth/User Section */}
                         <div>
                           {loading ? (
                              <div className="h-10 w-full animate-pulse rounded-md bg-muted"></div>
                           ) : user ? (
                               <div className="flex flex-col gap-2">
                                   <div className="flex items-center gap-2 mb-2 border-b pb-2">
                                        <Avatar className="h-8 w-8">
                                            <AvatarFallback className="text-xs">{getInitials(user.username)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col">
                                            <p className="text-sm font-medium leading-none">{user.username}</p>
                                            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                   <Button variant="ghost" className="justify-start gap-2 text-base py-3" onClick={() => handleMobileNavClick('/settings')}>
                                      <Settings className="h-5 w-5" />
                                      Settings
                                   </Button>
                                   <Button variant="ghost" className="justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-base py-3" onClick={handleLogout}>
                                      <LogOut className="h-5 w-5" />
                                      Log out
                                   </Button>
                               </div>
                           ) : (
                               <div className="flex flex-col gap-2">
                                   <Button variant="outline" className="justify-center text-base py-3" onClick={() => handleMobileNavClick('/login')}>
                                      <LogIn className="mr-2 h-5 w-5" /> Login
                                   </Button>
                                   <Button className="justify-center text-base py-3" onClick={() => handleMobileNavClick('/register')}>
                                      <UserPlus className="mr-2 h-5 w-5" /> Register
                                   </Button>
                               </div>
                           )}
                         </div>

                         {/* Mobile Theme Toggle */}
                         <div className="border-t pt-4">
                            <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" className="w-full justify-start gap-2 text-base py-3">
                                  <Palette className="h-5 w-5" /> Theme: <span className="ml-auto capitalize font-medium">{theme}</span>
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuPortal> {/* Use portal to avoid sheet clipping */}
                                 <DropdownMenuContent align="start" side="top" className="w-[calc(100vw-2rem)] max-w-xs mb-2"> {/* Adjust width */}
                                   <DropdownMenuLabel>Theme</DropdownMenuLabel>
                                   <DropdownMenuSeparator />
                                   <DropdownMenuRadioGroup value={theme} onValueChange={(newTheme) => { setTheme(newTheme); }}>
                                     <DropdownMenuRadioItem value="light">
                                       <Sun className="mr-2 h-4 w-4" /> Light
                                     </DropdownMenuRadioItem>
                                     <DropdownMenuRadioItem value="dark">
                                       <Moon className="mr-2 h-4 w-4" /> Dark
                                     </DropdownMenuRadioItem>
                                     <DropdownMenuRadioItem value="system">
                                       <Settings className="mr-2 h-4 w-4" /> System
                                     </DropdownMenuRadioItem>
                                   </DropdownMenuRadioGroup>
                                 </DropdownMenuContent>
                             </DropdownMenuPortal>
                           </DropdownMenu>
                         </div>
                    </div>
                </SheetContent>
              </Sheet>
            </div>
        </div>
      </div>
    </header>
  );
}

    