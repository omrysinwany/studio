
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Briefcase, Menu, Palette, Sun, Moon, Settings as SettingsIcon, Home, ScanLine, Package, BarChart2, FileTextIcon, LogIn, UserPlus, LogOut, Languages, Wand2 } from 'lucide-react';
import { Button, buttonVariants } from '@/components/ui/button';
import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuPortal
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet';
import React, { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useLanguage, Locale } from '@/context/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';

export default function Navigation() {
  const pathname = usePathname();
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLanguage();
  const { t } = useTranslation();

   // Conditional nav items based on auth state
   const getNavItems = () => {
    if (!user) {
      return [
        { href: '/', labelKey: 'nav_home', icon: Home, animationDelay: '0.1s' },
        { href: '/login', labelKey: 'nav_login', icon: LogIn, animationDelay: '0.2s' },
        { href: '/register', labelKey: 'nav_register', icon: UserPlus, animationDelay: '0.3s' },
      ];
    }
    return [
      { href: '/', labelKey: 'nav_home', icon: Home, animationDelay: '0.1s' },
      { href: '/upload', labelKey: 'nav_upload', icon: ScanLine, animationDelay: '0.2s' },
      { href: '/inventory', labelKey: 'nav_inventory', icon: Package, animationDelay: '0.3s' },
      { href: '/invoices', labelKey: 'nav_documents', icon: FileTextIcon, animationDelay: '0.4s' },
      { href: '/suppliers', labelKey: 'nav_suppliers', icon: Briefcase, animationDelay: '0.5s' },
      { href: '/reports', labelKey: 'nav_reports', icon: BarChart2, animationDelay: '0.6s' },
    ];
  };

  const currentNavItems = getNavItems();

  useEffect(() => {
    if (authLoading) {
      return;
    }
    const protectedPaths = ['/upload', '/inventory', '/invoices', '/suppliers', '/reports', '/settings', '/settings/pos-integration', '/settings/accountant', '/edit-invoice', '/paid-invoices'];
    const publicPaths = ['/login', '/register'];
    const isAuthPage = publicPaths.includes(pathname);
    const isProtectedPage = protectedPaths.some(path => pathname.startsWith(path));


    if (!user && isProtectedPage) {
        router.push('/login');
    } else if (user && isAuthPage) {
        router.push('/');
    }
  }, [user, authLoading, pathname, router]);


  const handleLogout = () => {
    logout();
    router.push('/login');
    setIsMobileSheetOpen(false);
  };

   const handleMobileNavClick = (href: string) => {
      router.push(href);
      setIsMobileSheetOpen(false);
   };

  const getInitials = (name: string | undefined) => {
    if (!name) return '?';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const changeLanguage = (newLocale: Locale) => {
    setLocale(newLocale);
    if (isMobileSheetOpen) setIsMobileSheetOpen(false);
  };

  const changeTheme = (newTheme: string) => {
    setTheme(newTheme);
    if (isMobileSheetOpen) setIsMobileSheetOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm" style={{ '--header-height': '4rem' } as React.CSSProperties}>
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        {/* Logo/Brand */}
        <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg hover:opacity-80 transition-opacity">
          <Package className="h-6 w-6 text-primary" />
          <span className="text-primary">{t('app_title')}</span>
        </Link>

        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {currentNavItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                buttonVariants({ variant: pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/') ? 'secondary' : 'ghost', size: 'sm' }),
                "transition-all duration-200 ease-in-out hover:scale-105",
                "scale-fade-in",
                (pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/')) ? "shadow-sm" : "hover:bg-muted"
              )}
               style={{ animationDelay: item.animationDelay }}
               aria-current={pathname === item.href ? 'page' : undefined}
            >
              <item.icon className="h-4 w-4" />
              {t(item.labelKey as any)}
            </Link>
          ))}
        </nav>

        {/* Right side controls: Combined Appearance Settings, Auth */}
        <div className="flex items-center gap-2 scale-fade-in" style={{ animationDelay: '0.8s' }}>
           {/* Combined Appearance Settings Dropdown (Desktop) */}
           <DropdownMenu>
             <DropdownMenuTrigger asChild>
               <Button variant="ghost" size="icon" className='hidden md:inline-flex transition-transform hover:scale-110'>
                  <Wand2 className="h-[1.2rem] w-[1.2rem]" />
                  <span className="sr-only">{t('appearance_settings')}</span>
               </Button>
             </DropdownMenuTrigger>
             <DropdownMenuContent align="end" className="w-56">
               <DropdownMenuLabel>{t('appearance_settings')}</DropdownMenuLabel>
               <DropdownMenuSeparator />
               <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('theme')}</DropdownMenuLabel>
               <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
                 <DropdownMenuRadioItem value="light">
                   <Sun className="mr-2 h-4 w-4" /> {t('light_theme')}
                 </DropdownMenuRadioItem>
                 <DropdownMenuRadioItem value="dark">
                   <Moon className="mr-2 h-4 w-4" /> {t('dark_theme')}
                 </DropdownMenuRadioItem>
                 <DropdownMenuRadioItem value="system">
                   <SettingsIcon className="mr-2 h-4 w-4" /> {t('system_theme')}
                 </DropdownMenuRadioItem>
               </DropdownMenuRadioGroup>
               <DropdownMenuSeparator />
               <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('language')}</DropdownMenuLabel>
                <DropdownMenuRadioGroup value={locale} onValueChange={(value) => changeLanguage(value as Locale)}>
                  <DropdownMenuRadioItem value="en">{t('english')}</DropdownMenuRadioItem>
                  <DropdownMenuRadioItem value="he">{t('hebrew')}</DropdownMenuRadioItem>
                </DropdownMenuRadioGroup>
             </DropdownMenuContent>
           </DropdownMenu>

          {/* Desktop Auth Controls */}
          <div className="hidden md:flex items-center gap-2">
              {authLoading ? (
                <div className="h-9 w-24 animate-pulse rounded-md bg-muted"></div>
              ) : user ? (
                 <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" className="relative h-9 w-9 rounded-full transition-transform hover:scale-110">
                      <Avatar className="h-9 w-9 border-2 border-primary/50">
                        <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">{getInitials(user.username)}</AvatarFallback>
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
                      <DropdownMenuItem onClick={() => router.push('/settings')} className="cursor-pointer">
                        <SettingsIcon className="mr-2 h-4 w-4" />
                        <span>{t('nav_settings')}</span>
                      </DropdownMenuItem>
                     <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={handleLogout} className="text-destructive focus:text-destructive focus:bg-destructive/10 cursor-pointer">
                      <LogOut className="mr-2 h-4 w-4" />
                      <span>{t('nav_logout')}</span>
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <>
                   <Button variant="ghost" size="sm" asChild>
                    <Link href="/login">
                       <span className="flex items-center">
                        <LogIn className="mr-1 h-4 w-4" /> {t('nav_login')}
                       </span>
                    </Link>
                  </Button>
                  <Button asChild size="sm" className="transition-transform hover:scale-105">
                    <Link href="/register">
                       <span className="flex items-center">
                        <UserPlus className="mr-1 h-4 w-4" />
                        {t('nav_register')}
                       </span>
                    </Link>
                  </Button>
                </>
              )}
          </div>

            {/* Mobile Menu Trigger */}
            <div className="md:hidden">
              <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="transition-transform hover:scale-110">
                    <Menu className="h-6 w-6" />
                     <span className="sr-only">{t('nav_toggle_navigation')}</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-full max-w-xs p-0 flex flex-col bg-background">
                    <SheetTitle className="sr-only">{t('nav_menu')}</SheetTitle>
                   <div className="p-4 border-b">
                      <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg mb-4" onClick={() => setIsMobileSheetOpen(false)}>
                          <Package className="h-6 w-6 text-primary" />
                          <span className="text-primary">{t('app_title')}</span>
                      </Link>
                    </div>
                    <nav className="flex-grow overflow-y-auto p-4 space-y-1">
                        {currentNavItems.map((item) => (
                          <Button
                             key={item.href}
                             variant={pathname === item.href || (pathname.startsWith(item.href) && item.href !== '/') ? 'secondary' : 'ghost'}
                             className="w-full justify-start gap-2 text-base py-3 h-auto"
                             onClick={() => handleMobileNavClick(item.href)}
                          >
                             <item.icon className="h-5 w-5" />
                             {t(item.labelKey as any)}
                          </Button>
                        ))}
                      </nav>

                    {/* Mobile Auth, Appearance Settings in Footer */}
                    <div className="mt-auto border-t p-4 space-y-4">
                         <div>
                           {authLoading ? (
                              <div className="h-10 w-full animate-pulse rounded-md bg-muted"></div>
                           ) : user ? (
                               <div className="flex flex-col gap-2">
                                   <div className="flex items-center gap-2 mb-2 border-b pb-2">
                                        <Avatar className="h-8 w-8 border-2 border-primary/50">
                                            <AvatarFallback className="text-xs bg-primary/10 text-primary font-semibold">{getInitials(user.username)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col">
                                            <p className="text-sm font-medium leading-none">{user.username}</p>
                                            <p className="text-xs leading-none text-muted-foreground">{user.email}</p>
                                        </div>
                                    </div>
                                     <Button variant="ghost" className="justify-start gap-2 text-base py-3 h-auto" onClick={() => handleMobileNavClick('/settings')}>
                                        <SettingsIcon className="h-5 w-5" />
                                        {t('nav_settings')}
                                     </Button>
                                   <Button variant="ghost" className="justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-base py-3 h-auto" onClick={handleLogout}>
                                      <LogOut className="h-5 w-5" />
                                      {t('nav_logout')}
                                   </Button>
                               </div>
                           ) : (
                               <div className="flex flex-col gap-2">
                                   <Button variant="outline" className="justify-center text-base py-3 h-auto" onClick={() => handleMobileNavClick('/login')}>
                                      <LogIn className="mr-2 h-5 w-5" /> {t('nav_login')}
                                   </Button>
                                   <Button className="justify-center text-base py-3 h-auto" onClick={() => handleMobileNavClick('/register')}>
                                      <UserPlus className="mr-2 h-5 w-5" /> {t('nav_register')}
                                   </Button>
                               </div>
                           )}
                         </div>

                         {/* Combined Appearance Settings Dropdown (Mobile) */}
                         <div className="border-t pt-4">
                            <DropdownMenu>
                             <DropdownMenuTrigger asChild>
                               <Button variant="ghost" className="w-full justify-start gap-2 text-base py-3 h-auto">
                                  <Wand2 className="h-5 w-5" /> {t('appearance_settings')}
                               </Button>
                             </DropdownMenuTrigger>
                             <DropdownMenuPortal>
                                  <DropdownMenuContent align="start" side="top" className="w-[calc(100vw-2rem)] max-w-xs mb-2">
                                   <DropdownMenuLabel>{t('appearance_settings')}</DropdownMenuLabel>
                                   <DropdownMenuSeparator />
                                   <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('theme')}</DropdownMenuLabel>
                                   <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
                                     <DropdownMenuRadioItem value="light">
                                       <Sun className="mr-2 h-4 w-4" /> {t('light_theme')}
                                     </DropdownMenuRadioItem>
                                     <DropdownMenuRadioItem value="dark">
                                       <Moon className="mr-2 h-4 w-4" /> {t('dark_theme')}
                                     </DropdownMenuRadioItem>
                                     <DropdownMenuRadioItem value="system">
                                       <SettingsIcon className="mr-2 h-4 w-4" /> {t('system_theme')}
                                     </DropdownMenuRadioItem>
                                   </DropdownMenuRadioGroup>
                                   <DropdownMenuSeparator />
                                   <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('language')}</DropdownMenuLabel>
                                    <DropdownMenuRadioGroup value={locale} onValueChange={(value) => changeLanguage(value as Locale)}>
                                      <DropdownMenuRadioItem value="en">{t('english')}</DropdownMenuRadioItem>
                                      <DropdownMenuRadioItem value="he">{t('hebrew')}</DropdownMenuRadioItem>
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
