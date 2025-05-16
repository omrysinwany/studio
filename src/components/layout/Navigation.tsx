
// src/components/layout/Navigation.tsx
'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Briefcase, Menu, Palette, Sun, Moon, Settings as SettingsIcon, Home, ScanLine, Package, BarChart2, FileText as FileTextIcon, LogIn, UserPlus, LogOut, Languages, Wand2, CreditCard, ListChecks, Grid } from 'lucide-react';
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
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import React, { useState, useEffect } from 'react';
import { useTheme } from 'next-themes';
import { useLanguage, Locale } from '@/context/LanguageContext';
import { useTranslation } from '@/hooks/useTranslation';
import { useIsMobile } from '@/hooks/use-mobile';
import { Separator } from '@/components/ui/separator';


export default function Navigation() {
  const pathname = usePathname();
  const { user, logout, loading: authLoading } = useAuth();
  const router = useRouter();
  const [isMobileSheetOpen, setIsMobileSheetOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const { locale, setLocale } = useLanguage();
  const { t } = useTranslation();
  const isMobile = useIsMobile();


  const navItemsBase = [
    { href: '/', labelKey: 'nav_home', icon: Home, animationDelay: '0.1s' },
    { href: '/upload', labelKey: 'nav_upload', icon: ScanLine, animationDelay: '0.2s', protected: true },
    { href: '/inventory', labelKey: 'nav_inventory', icon: Package, animationDelay: '0.3s', protected: true },
    { href: '/invoices', labelKey: 'nav_documents', icon: FileTextIcon, animationDelay: '0.4s', protected: true },
    { href: '/accounts', labelKey: 'nav_accounts', icon: CreditCard, animationDelay: '0.5s', protected: true },
    { href: '/suppliers', labelKey: 'nav_suppliers', icon: Briefcase, animationDelay: '0.6s', protected: true },
    { href: '/reports', labelKey: 'nav_reports', icon: BarChart2, animationDelay: '0.7s', protected: true },
  ];

  const navItemsLoggedOut = [
    { href: '/', labelKey: 'nav_home', icon: Home, animationDelay: '0.1s' },
    { href: '/login', labelKey: 'nav_login', icon: LogIn, animationDelay: '0.2s' },
    { href: '/register', labelKey: 'nav_register', icon: UserPlus, animationDelay: '0.3s' },
  ];

  const currentNavItems = user
    ? navItemsBase.map(item => ({ ...item, label: t(item.labelKey) }))
    : navItemsLoggedOut.map(item => ({ ...item, label: t(item.labelKey) }));


  useEffect(() => {
    if (authLoading) {
      return;
    }
    const protectedPaths = navItemsBase.filter(item => item.protected).map(item => item.href);
    const publicPaths = ['/login', '/register'];
    const isAuthPage = publicPaths.includes(pathname);
    
    // Check if current pathname starts with any of the protected paths
    // and is not exactly '/' if '/' is also considered protected for some reason.
    // It's generally better to be explicit about which paths are protected.
    // For now, assuming / is public unless specified otherwise.
    let isActuallyProtectedPage = false;
    for (const protectedPath of protectedPaths) {
        if (pathname === protectedPath || (protectedPath !== '/' && pathname.startsWith(protectedPath + '/'))) {
            isActuallyProtectedPage = true;
            break;
        }
    }
    
    if (!user && isActuallyProtectedPage && !isAuthPage) {
        console.log(`[Navigation] User not authenticated and on protected page ${pathname}. Redirecting to login.`);
        router.push('/login');
    } else if (user && isAuthPage) {
        console.log(`[Navigation] User authenticated and on auth page ${pathname}. Redirecting to home.`);
        router.push('/');
    }
  }, [user, authLoading, pathname, router, navItemsBase]);


  const handleLogout = () => {
    logout();
    setIsMobileSheetOpen(false);
  };

   const handleMobileNavClick = (href: string) => {
      router.push(href);
      setIsMobileSheetOpen(false);
   };

  const getInitials = (name: string | undefined | null) => {
    if (!name) return '?';
    return name.trim().split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
  };

  const changeLanguage = (newLocale: string) => {
    setLocale(newLocale as Locale);
  };

  const changeTheme = (newTheme: string) => {
    setTheme(newTheme);
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-sm" style={{ '--header-height': '4rem' } as React.CSSProperties}>
      <div className="container flex h-16 items-center justify-between px-4 md:px-6">
        <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg hover:opacity-80 transition-opacity">
          <Package className="h-6 w-6 text-primary" />
          <span className="text-primary">{t('app_name_short')}</span>
        </Link>

        <nav className="hidden md:flex items-center gap-1 lg:gap-2">
          {currentNavItems.map((item) => {
            if (!user && item.protected) return null;

            const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  buttonVariants({ variant: isActive ? 'secondary' : 'ghost', size: 'sm' }),
                  "transition-all duration-200 ease-in-out hover:scale-105",
                  "scale-fade-in",
                  isActive ? "shadow-sm" : "text-foreground hover:bg-muted/60 hover:text-primary dark:hover:bg-accent dark:hover:text-accent-foreground",
                  !isActive && "text-foreground"
                )}
                 style={{ animationDelay: item.animationDelay }}
                 aria-current={isActive ? 'page' : undefined}
              >
                <item.icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-1 sm:gap-2 scale-fade-in" style={{ animationDelay: '0.8s' }}>
           <div className="hidden md:flex"> {/* This div hides the button on mobile */}
             <DropdownMenu>
               <DropdownMenuTrigger asChild>
                 <Button variant="ghost" size="icon" className="h-8 w-8 sm:h-9 sm:w-9 transition-transform hover:scale-110">
                    <Wand2 className="h-[1.1rem] w-[1.1rem] sm:h-[1.2rem] sm:w-[1.2rem]" />
                    <span className="sr-only">{t('nav_appearance_settings_tooltip')}</span>
                 </Button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="end" className="w-56">
                 <DropdownMenuLabel>{t('nav_appearance_settings_title')}</DropdownMenuLabel>
                 <DropdownMenuSeparator />
                 <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('nav_theme_label')}</DropdownMenuLabel>
                 <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
                   <DropdownMenuRadioItem value="light">
                     <Sun className="mr-2 h-4 w-4" /> {t('nav_theme_light')}
                   </DropdownMenuRadioItem>
                   <DropdownMenuRadioItem value="dark">
                     <Moon className="mr-2 h-4 w-4" /> {t('nav_theme_dark')}
                   </DropdownMenuRadioItem>
                   <DropdownMenuRadioItem value="system">
                     <SettingsIcon className="mr-2 h-4 w-4" /> {t('nav_theme_system')}
                   </DropdownMenuRadioItem>
                 </DropdownMenuRadioGroup>
                 <DropdownMenuSeparator />
                 <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('nav_language_label')}</DropdownMenuLabel>
                  <DropdownMenuRadioGroup value={locale} onValueChange={(value) => changeLanguage(value as string)}>
                    <DropdownMenuRadioItem value="en">{t('nav_language_en')}</DropdownMenuRadioItem>
                    <DropdownMenuRadioItem value="he">{t('nav_language_he')}</DropdownMenuRadioItem>
                  </DropdownMenuRadioGroup>
               </DropdownMenuContent>
             </DropdownMenu>
            </div>

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
                        <p className="text-sm font-medium leading-none">{user.username || user.email}</p>
                        {user.username && user.email && <p className="text-xs leading-none text-muted-foreground">{user.email}</p>}
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
                     <Link href="/login" className="flex items-center">
                       <span className="flex items-center">
                         <LogIn className="mr-1 h-4 w-4" /> {t('nav_login')}
                       </span>
                     </Link>
                   </Button>
                  <Button size="sm" className="transition-transform hover:scale-105" asChild>
                    <Link href="/register" className="flex items-center">
                       <span className="flex items-center">
                         <UserPlus className="mr-1 h-4 w-4" />
                         {t('nav_register')}
                       </span>
                    </Link>
                  </Button>
                </>
              )}
          </div>

            <div className="md:hidden">
              <Sheet open={isMobileSheetOpen} onOpenChange={setIsMobileSheetOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="transition-transform hover:scale-110">
                    <Menu className="h-6 w-6" />
                     <span className="sr-only">{t('nav_toggle_navigation_tooltip')}</span>
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="w-full max-w-xs p-0 flex flex-col bg-background">
                    <SheetHeader className="p-4 border-b">
                      <SheetTitle className="sr-only">{t('nav_menu_title')}</SheetTitle>
                       <Link href="/" className="flex items-center gap-2 font-bold text-primary text-lg mb-4" onClick={() => setIsMobileSheetOpen(false)}>
                          <Package className="h-6 w-6 text-primary" />
                          <span className="text-primary">{t('app_name_short')}</span>
                      </Link>
                    </SheetHeader>
                    <nav className="flex-grow overflow-y-auto p-4 space-y-1">
                        {currentNavItems.map((item) => {
                          if (!user && item.protected) return null;

                          const isActive = pathname === item.href || (item.href !== '/' && pathname.startsWith(item.href));
                          return (
                            <Button
                               key={item.href}
                               variant={isActive ? 'secondary' : 'ghost'}
                               className={cn(
                                 "w-full justify-start gap-2 text-base py-3 h-auto",
                                 !isActive && "text-foreground hover:text-primary dark:hover:text-accent-foreground hover:bg-muted/60 dark:hover:bg-accent"
                               )}
                               onClick={() => handleMobileNavClick(item.href)}
                            >
                               <item.icon className="h-5 w-5" />
                               {item.label}
                            </Button>
                          );
                        })}

                        {(pathname.startsWith('/inventory') || pathname.startsWith('/invoices')) && (
                          <>
                            <DropdownMenuSeparator className="my-2"/>
                            <DropdownMenuLabel className="px-2 text-xs text-muted-foreground">{t('nav_view_options_label')}</DropdownMenuLabel>
                          </>
                        )}
                        {pathname.startsWith('/inventory') && (
                          <Button
                            variant="ghost"
                            className="w-full justify-start gap-2 text-base py-3 h-auto text-foreground hover:text-primary dark:hover:text-accent-foreground"
                            onClick={() => {
                              const currentSearchParams = new URLSearchParams(window.location.search);
                              const currentView = currentSearchParams.get('mobileView') || 'cards';
                              const nextView = currentView === 'cards' ? 'table' : 'cards';
                              currentSearchParams.set('mobileView', nextView);
                              handleMobileNavClick(`/inventory?${currentSearchParams.toString()}`);
                            }}
                          >
                            <Palette className="h-5 w-5" />
                            {t(new URLSearchParams(window.location.search).get('mobileView') === 'table' ? 'nav_view_cards_inventory' : 'nav_view_table_inventory')}
                          </Button>
                        )}
                        {pathname.startsWith('/invoices') && (
                           <Button
                            variant="ghost"
                            className="w-full justify-start gap-2 text-base py-3 h-auto text-foreground hover:text-primary dark:hover:text-accent-foreground"
                            onClick={() => {
                              const currentSearchParams = new URLSearchParams(window.location.search);
                              const currentView = currentSearchParams.get('mobileView') || 'grid';
                              const nextView = currentView === 'grid' ? 'list' : 'grid';
                              currentSearchParams.set('mobileView', nextView);
                              handleMobileNavClick(`/invoices?${currentSearchParams.toString()}`);
                            }}
                          >
                            <Palette className="h-5 w-5" />
                             {t(new URLSearchParams(window.location.search).get('mobileView') === 'list' ? 'nav_view_grid_invoices' : 'nav_view_list_invoices')}
                          </Button>
                        )}
                      </nav>

                    <div className="mt-auto border-t p-4 space-y-2 bg-muted/30">
                         <div>
                           {authLoading ? (
                              <div className="h-10 w-full animate-pulse rounded-md bg-muted"></div>
                           ) : user ? (
                               <div className="flex flex-col gap-1">
                                   <div className="flex items-center gap-3 mb-2 p-2 rounded-md">
                                        <Avatar className="h-10 w-10 border-2 border-primary/50">
                                            <AvatarFallback className="text-sm bg-primary/10 text-primary font-semibold">{getInitials(user.username)}</AvatarFallback>
                                        </Avatar>
                                        <div className="flex flex-col">
                                            <p className="text-base font-medium leading-tight">{user.username || user.email}</p>
                                            {user.username && user.email && <p className="text-xs leading-tight text-muted-foreground">{user.email}</p>}
                                        </div>
                                    </div>
                                     <Separator className="my-2 bg-border/50" />
                                     <Button variant="ghost" className="w-full justify-start gap-2 text-base py-3 h-auto text-foreground hover:text-primary dark:hover:text-accent-foreground" onClick={() => handleMobileNavClick('/settings')}>
                                        <SettingsIcon className="h-5 w-5" />
                                        {t('nav_settings')}
                                     </Button>
                                     <DropdownMenu>
                                         <DropdownMenuTrigger asChild>
                                           <Button variant="ghost" className="w-full justify-start gap-2 text-base py-3 h-auto text-foreground hover:text-primary dark:hover:text-accent-foreground">
                                              <Wand2 className="h-5 w-5" /> {t('nav_appearance_settings_title')}
                                           </Button>
                                         </DropdownMenuTrigger>
                                         <DropdownMenuPortal>
                                              <DropdownMenuContent align="start" side="top" className="w-[calc(100vw-2rem)] max-w-xs mb-2">
                                               <DropdownMenuLabel>{t('nav_appearance_settings_title')}</DropdownMenuLabel>
                                               <DropdownMenuSeparator />
                                               <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('nav_theme_label')}</DropdownMenuLabel>
                                               <DropdownMenuRadioGroup value={theme} onValueChange={changeTheme}>
                                                 <DropdownMenuRadioItem value="light">
                                                   <Sun className="mr-2 h-4 w-4" /> {t('nav_theme_light')}
                                                 </DropdownMenuRadioItem>
                                                 <DropdownMenuRadioItem value="dark">
                                                   <Moon className="mr-2 h-4 w-4" /> {t('nav_theme_dark')}
                                                 </DropdownMenuRadioItem>
                                                 <DropdownMenuRadioItem value="system">
                                                   <SettingsIcon className="mr-2 h-4 w-4" /> {t('nav_theme_system')}
                                                 </DropdownMenuRadioItem>
                                               </DropdownMenuRadioGroup>
                                               <DropdownMenuSeparator />
                                               <DropdownMenuLabel className="text-xs text-muted-foreground px-2 py-1">{t('nav_language_label')}</DropdownMenuLabel>
                                                <DropdownMenuRadioGroup value={locale} onValueChange={(value) => changeLanguage(value as string)}>
                                                  <DropdownMenuRadioItem value="en">{t('nav_language_en')}</DropdownMenuRadioItem>
                                                  <DropdownMenuRadioItem value="he">{t('nav_language_he')}</DropdownMenuRadioItem>
                                                </DropdownMenuRadioGroup>
                                             </DropdownMenuContent>
                                          </DropdownMenuPortal>
                                       </DropdownMenu>
                                   <Button variant="ghost" className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10 text-base py-3 h-auto" onClick={handleLogout}>
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
                    </div>
                </SheetContent>
              </Sheet>
            </div>
        </div>
      </div>
    </header>
  );
}

    